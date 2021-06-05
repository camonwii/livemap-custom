/// <reference path="./socket.js" />

import {Config} from "./config.js";
import {Utils} from "./utils.js";
import {Initializer} from "./init.js";
import {Alerter} from "./alerter.js";
import {MarkerObject, Coordinates} from "./objects.js";

L.Control.CustomLayer = L.Control.Layers.extend({
    _checkDisabledLayers: function () {}
});

export class MapWrapper {

    /**
     * Creates an instance of MapWrapper.
     * @param {SocketHandler} socketHandler
     * @memberof MapWrapper
     */
    constructor(socketHandler){
        this.MarkerStore = [];
        this.PopupStore = {}; // { MarkerId: Popup }
        this.CurrentLayer = undefined;
        this.PlayerMarkers = L.markerClusterGroup({
            maxClusterRadius: 20,
            spiderfyOnMaxZoom: false,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: false
        });
        this.socketHandler = socketHandler;
        this.Map = undefined;
        this.connectedTo = {};

        this.Filter = undefined; // For filtering players
        this.CanFilterOn = []; // What can the user filter?

        this.blips= [];
        this.showBlips = true;
        this.disabledBlips = [];
        this.blipCount = 0;

        this.mapInit("mapConvas");
    }

    createBlip(blip, markerTypes){
        Config.log("Creating blip", blip);
        if (!blip.hasOwnProperty("pos")){
            // BACKWARDS COMPATABILITY!!
            blip.pos = { x: blip.x, y: blip.y, z: blip.z};

            //Delete the old shit.. It's nicly wrapped in the pos object now
            delete blip.x;
            delete blip.y;
            delete blip.z;
        }

        var obj = new MarkerObject(blip.name, new Coordinates(blip.pos.x, blip.pos.y, blip.pos.z), markerTypes[blip.type], blip.description, "", "");

        if (this.blips[blip.type] == null){
            this.blips[blip.type] = [];
        }

        blip.markerId = this.createMarker(false, obj, "") - 1;

        this.blips[blip.type].push(blip);
        this.blipCount++;
    }

    toggleBlips(){
        for (var spriteId in this.blips) {
            var blipArray = this.blips[spriteId];
            Config.log("Disabled (" + spriteId + ")? " + this.disabledBlips.includes(spriteId));

            if (this.disabledBlips.indexOf(spriteId) != -1) {
                //console.log("Blip " + spriteId + "'s are disabled..");

                blipArray.forEach(blip => {
                    //console.log(blip);
                    var marker = this.MarkerStore[blip.markerId];
                    marker.remove();
                });

                // If disabled, don't make a marker for it
                continue;
            }

            blipArray.forEach(blip => {
                //console.log(blip);
                var marker = this.MarkerStore[blip.markerId];
                if (this.showBlips){
                    marker.addTo(this.Map);
                }else{
                    marker.remove();
                }
            });
        }
    }

    changeServer(nameOfServer){
        Config.log("Changing connected server to: " + nameOfServer);
        if (!(nameOfServer in Config.staticConfig.servers)) {
            new Alerter({
                title: window.Translator.t("errors.server-config.title"),
                text: window.Translator.t("errors.server-config.message", {nameOfServer})
            });
            return;
        }

        this.connectedTo = Config.staticConfig.servers[nameOfServer];

        this.connectedTo.getBlipUrl = function () {
            // this = the "connectedTo" server
            if (this.reverseProxy && this.reverseProxy.blips) {
                return this.reverseProxy.blips;
            }
            return `http://${this.ip}:${this.socketPort}/blips.json`;
        }

        this.connectedTo.getSocketUrl = function () {
            // this = the "connectedTo" server
            if (this.reverseProxy && this.reverseProxy.socket) {
                return this.reverseProxy.socket;
            }
            return `ws://${this.ip}:${this.socketPort}`;
        }

        // If we've changed servers. Might as well reset everything.
        if (this.socketHandler.webSocket && this.socketHandler.webSocket.readyState == WebSocket.OPEN) this.socketHandler.webSocket.close();

        // $("#serverName").text(nameOfServer);

        document.getElementById("serverName").innerText = nameOfServer;

        // // Reset controls.
        // $("#playerSelect").children().remove();
        // $("#playerSelect").append("<option></option>");

        // $("#filterOn").children().remove();
        // $("#filterOn").append("<option></option>");
        // $("#onlyShow").text("");
        this.Filter = undefined;

        const _ = this;
        setTimeout( function () {
            Initializer.blips(_.connectedTo.getBlipUrl(), window.markers, _);

            _.socketHandler.connect(_.connectedTo.getSocketUrl(), _);
        }, 50);
    }

    mapInit(elementID){
        // Create the different layers
        const config = Config.getConfig();
        let tileLayers = {};
        let maps = config.maps;
        maps.forEach(map => {
            Config.log(map);
            if (map.tileSize){ map.tileSize = 1024; } // Force 1024 down/up scale

            tileLayers[map.name] = L.tileLayer(map.url,
                Object.assign(
                { minZoom: -2, maxZoom: 2, tileSize: 1024, maxNativeZoom: 0, minNativeZoom: 0, tileDirectory: config.tileDirectory },
                map)
            );
            Config.log(tileLayers[map.name]);
        });

        this.CurrentLayer = tileLayers[Object.keys(tileLayers)[0]];

        this.Map =  window.MapL = L.map(elementID, {
            crs: L.CRS.Simple,
            layers: [this.CurrentLayer]
        }).setView([0,0], 0);

        let mapBounds = Utils.getMapBounds(this.CurrentLayer);

        this.Map.setMaxBounds(mapBounds);
        this.Map.fitBounds(mapBounds);

        let control = new L.Control.CustomLayer(tileLayers).addTo(this.Map);
        this.Map.addLayer(this.PlayerMarkers);
    }

    createMarker(draggable, objectRef, title) {
        let name = objectRef.reference;
        if (name == "@DEBUG@@Locator") {
            name = "@Locator";
        }

        objectRef.position = Utils.stringCoordToFloat(objectRef.position);
        //Config.log(objectRef.position);
        let coord = Utils.convertToMapLeaflet(this.CurrentLayer, objectRef.position.x, objectRef.position.y);
        //Config.log(coord);
        let markerType = objectRef.type;

        //Config.log(JSON.stringify(locationType));


        //TODO: TRANSLATE ENGLISH HERE
        let html = '<div class="row info-body-row"><strong>Position:</strong>&nbsp;X {' + objectRef.position.x.toFixed(2) + "} Y {" + objectRef.position.y.toFixed(2) + "} Z {" + objectRef.position.z.toFixed(2) + "}</div>";

        if (objectRef.description != ""){
            html += '<div class="row info-body-row"><strong>Description:</strong>&nbsp;' + objectRef.description + "</div>";
        }

        let infoContent = '<div class="info-window"><div class="info-header-box"><div class="info-header">' + name + '</div></div><div class="clear"></div><div class=info-body>' + html + "</div></div>";

        let image = L.icon(markerType);

        let where = this.Map;
        if(objectRef.data && objectRef.data.isPlayer && Config.getConfig().groupPlayers){
            // Add to the cluster layer
            where = this.PlayerMarkers;
        }
        if(where == undefined){
            console.warn("For some reason window.MapL or window.PlayerMarkers is undefined");
            console.warn("Cannot add the blip: " + objectRef);
            where = this.createClusterLayer();
        }

        let marker = L.marker(coord, {
            title: title,
            id: this.MarkerStore.length,
            icon: image,
            object: objectRef,
            player: objectRef.data.player ? objectRef.data.player : undefined,
            draggable: draggable ? true : false
        }).addTo(where).bindPopup(infoContent);

        this.MarkerStore.push(marker);
        return this.MarkerStore.length;
    }

    createClusterLayer(){
        this.PlayerMarkers = L.markerClusterGroup({ // Re-make it fresh
            maxClusterRadius: 20,
            spiderfyOnMaxZoom: false,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: false
        });
        this.Map.addLayer(this.PlayerMarkers); // Add it back. The clearAllMarkers() will ensure player markers are added to the new cluster layer
        //initPlayerMarkerControls(Map, PlayerMarkers); //Reinitialise the event to allow clicking...
        return this.PlayerMarkers;
    }

    setMapCenter(lat, lng) {
        this.Map.setCenter([lat, lng]);
        this.Map.setZoom(6);
    }

    setMapCenterLeaflet(coord) {
        this.Map.setCenter(coord);
        this.Map.setZoom(6);
    }

    clearAllMarkers() {
        for (let i = 0; i < this.MarkerStore.length; i++) {
            this.clearMarker(i);
        }
        this.MarkerStore.length = 0;

        // Re-do player markers
        for(let id in this.socketHandler.localCache){
            this.socketHandler.localCache[id].marker = null;
        }
        if(this.Map != undefined){
            this.Map.removeLayer(this.PlayerMarkers); // Remove the cluster layer
            this.PlayerMarkers = undefined;

            setTimeout(this.createClusterLayer.bind(this), 10);
        }
    }

    clearMarker(id) {
        if (this.MarkerStore[id] != "NULL") {
            this.MarkerStore[id].remove();
            this.MarkerStore[id] = "NULL";
            document.getElementById(`marker_${id}`).remove();
        }
    }

    getMarker(id) {
        if (this.MarkerStore[id] != "NULL") {
            return this.MarkerStore[id];
        }
    }

    getBlipMarker(blip){
        if(this.blips[blip.type] == null){
            return -1;
        }

        var blipArrayForType = this.blips[blip.type];

        for(var b in blipArrayForType){
            var blp = blipArrayForType[b];

            if (blp.pos.x == blip.pos.x && blp.pos.y == blip.pos.y && blp.pos.z == blip.pos.z){
                return {index: b, blip: blp};
            }
        }

        // Couldn't find it..
        return -1;
    }

    doesBlipExist(blip){
        return this.getBlipMarker(blip) != -1;
    }

    addBlip(blipObj, markers) {
        if (this.doesBlipExist(blipObj)) {
            return; // Meh, it already exists.. Just don't add it
        }

        if (!blipObj.hasOwnProperty("name")) { // Doesn't have a name
            if (markers.MarkerTypes[spriteId] == null || markers.MarkerTypes[spriteId].name == undefined) {
                // No stored name, make one up. All markers _should_ have a name though.
                blipObj.name = "Dynamic Marker";
            } else {
                blipObj.name = markers.MarkerTypes[spriteId].name;
            }
        }

        if (!blipObj.hasOwnProperty("description")) { // Doesn't have a description
            blipObj.description = "";
        }

        this.createBlip(blipObj);
    }

    removeBlip(blipObj) {
        if (this.doesBlipExist(blipObj)) {
            // Remove it

            let blp = this.getBlipMarker(blipObj);
            let markerId = blp.blip.markerId;
            let index = blp.index;

            this.clearMarker(markerId);

            this.blips[blipObj.type].splice(index, 1);

            if (this.blips[blipObj.type].length == 0) {
                delete this.blips[blipObj.type];
            }

            this.blipCount--;
            document.getElementById("blipCount").textContent = this.blipCount;
        }
    }

    //TODO: Refactor
    updateBlip(blipObj, markers) {
        if (this.doesBlipExist(blipObj)) {
            // Can update it
            let blp = this.getBlipMarker(blipObj);
            let markerId = blp.blip.markerId;
            let blipIndex = blp.index;

            let marker = this.MarkerStore[markerId];

            if (blipObj.hasOwnProperty("new_pos")) {
                // Blips are supposed to be static so, why this would even be fucking needed it beyond me
                // Still, better to prepare for the inevitability that someone wants this fucking feature
                marker.setLatLng(Utils.convertToMap(blipObj.new_pos.x, blipObj.new_pos.y, blipObj.new_pos.z));
                blipObj.pos = blipObj.new_pos;
                delete blipObj.new_pos;
            }

            let name = "No name blip..";
            let html = "";

            if (blipObj.hasOwnProperty("name")) {
                name = blipObj.name;
            } else {
                // No name given, might as well use the default one... If it exists...
                if (markers.MarkerTypes[blipObj.type] != undefined && markers.MarkerTypes[blipObj.type].name != undefined) {
                    name = markers.MarkerTypes[blipObj.type].name;
                }
            }

            for (let key in blipObj) {

                if (key == "name" || key == "type") {
                    continue; // Name is already shown
                }

                if (key == "pos") {
                    //TODO: Use translations
                    //TODO: Maybe move into Utils?
                    html += Utils.getPositionHtml(blipObj[key]);
                } else {
                    // Make sure the first letter of the key is capitalised
                    key[0] = key[0].toUpperCase();
                    html += Utils.getHtmlForInformation(key, blipObj[key]);
                }
            }

            let info = Utils.getInfoHtmlForMarkers(name, html);

            marker.unbindPopup();
            marker.bindPopup(info);

            this.blips[blipObj.type][blipIndex] = blipObj;
        }
    }

}
