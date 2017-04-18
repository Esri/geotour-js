# GeoTour JS

This component takes a feature service of stops and animates great circle lines between them using the 4.0 ArcGIS API for JavaScript in either a 2D [`MapView`](https://developers.arcgis.com/javascript/latest/api-reference/esri-views-MapView.html) or a 3D [`SceneView`](https://developers.arcgis.com/javascript/latest/api-reference/esri-views-SceneView.html).

See a live version [here](https://esri.github.io/geotour-js/).

All it requires is a feature service with integer `Sequence` and string `Name` fields where records are to be visited in ascending `Sequence` order.

![GeoTour](./geotour.gif)

## Features

* Animate a tour between the stops stored in a Feature Layer.
* Works in 2D or 3D.
* Configuration via URL parameters.
* Watchable properties, in line with the 4.0 ArcGIS API for JavaScript.

## Usage
Include the component by modifying `dojoConfig` before including the JS API (see the [Advanced](#relative-paths-in-the-dojoconfig) section below for your own deployments).

``` HTML
<script type="text/javascript">
var dojoConfig = {
  packages: [{
    name: "geotour",
    location: 'https://esri.github.io/geotour-js/src/js'
  }]
};
</script>
```

Then create a tour instance, passing the `MapView` or `SceneView` to use for display. The instance will read properties from the URL's QueryString, loading features and parsing out arcs to animate through. The following code loads the default demo data and automatically starts the tour animation:

``` JavaScript
require([
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/TileLayer",
  "geotour/tour",
  "dojo/domReady!"
], function(Map, MapView, TileLayer, Tour) {

  // Create the map.
  var map = new Map({
    basemap: {
      baseLayers: [new TileLayer({
        url: "https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer"
      })]
    }
  });

  // And the view.
  var view = new MapView({
    container: "viewDiv",
    map: map,
    center: [-100.68, 45.52], // lon, lat
    zoom: 4
  });

  // Start a tour
  var tour = new Tour({
    view: view, 
    autoStart: true
  });
});
```

### Constructor
The constructor requires at least one parameter, the `MapView` or `SceneView` to animate the tour in. By default, the tour will load its data but will wait to be manually started:

``` JavaScript
  var tour = new Tour(view);
```

Alternatively, you can pass in a JSON object to configure the Tour. In this case the animation is started automatically as soon as possible:

``` JavaScript
  // Start as soon as the view has loaded.
  var tour = new Tour({
    view: view, 
    autoStart: true
  });
```

See the [Configuration Parameters](#configuration-parameters) section for more info.

### Animating the tour
By default, the tour will not start automatically (see the constructors above). You should wait until the tour is `ready` (that is, it has loaded all its data and is ready to start).

``` JavaScript
  var tour = new Tour(view);

  tour.watch("ready", function () {
    view.goTo(tour.extent).then(function () {
      tour.animate();
    });
  });
```

### Tour properties
A `Tour` instance has the following [watchable](https://developers.arcgis.com/javascript/latest/guide/working-with-props/index.html) properties:

| Property | Description |
| -------- | ----------- |
| ready | `true` when enough data has been loaded to start the tour. Initially `false`. |
| extent | An [`Extent`](https://developers.arcgis.com/javascript/latest/api-reference/esri-geometry-Extent.html) object describing the bounds of the tour. Will be populated by the time the tour is `ready`. |
| loadError | Will be `undefined` unless an error is encountered loading the tour data. |

### Tour methods
A `Tour` instance has the following methods:

| Method | Description |
| ------ | ----------- |
| `animate()` | Starts the tour animation and returns a [promise](https://developers.arcgis.com/javascript/latest/guide/working-with-promises/index.html) that is fulfilled when the animation ends. Call `cancel()` on this promise to abort the animation. |
| `animateWithDelay()` | Same as `animate()` but the first parameter is a delay in milliseconds before the animation begins. |
| `clearDisplay()` | When you start an animation, any graphics from a previous display of the tour are cleared. This function is useful if you need to clear the display without starting a new animation. |

### Configuration Parameters

Parameters can be passed into the tour constructor in a JSON object. The following parameters are supported:

| Parameter           | Value |
| ------------------- | ----- |
| `allowURLParameters` | Set this to `false` to prevent configuration being read from the URL. It can also be set to an array to whitelist only specific properties (e.g. `["duration", "autoStartDelay"]`). Defaults to `true` to allow all properties to be specified in the URL. |
| `autoStart` | Whether to start the tour automatically once the `MapView` or `SceneView` is ready. Default `false`. |
| `autoStartDelay` | The delay in milliseconds before autostarting. Ignored if `autoStart` is not `true`. Default `0` (no delay). |
| `duration` | Override the target duration of the entire animation in seconds (default 30s). |
| `stopLayerURL`    | The URL to a public Feature Service Layer containing points to tour between. See [Creating Data](#creating-data). |
| `stopNameField`     | Override the field to use for reading the point's name to display on the map (default `Name`). |
| `stopSequenceField` | Override the field to use for reading the point's sequence in the tour (default `Sequence`). |

These settings may also be read from the URL's Query String, but values passed to the constructor will take precedence.

All parameters are optional. If no parameters are provided, a demo dataset with a detailed real-world route is used (see the advanced `routeResultServiceURL` parameter). If a `stopLayerURL` is provided instead, the component will generate Great Circle Arcs between the stops.

### Creating data
There are many ways to create a Stop Service that you can pass to `stopLayerURL`. The key is to create a Feature Service Layer that meets the following criteria:

* Has Point Geometry.
* Has a `Name` field to display on the map.
* Has a `Sequence` field to determine the order the tour visits the points.
* Is shared with everyone (i.e. public).

Here are some ways to create a suitable stop service:

* [Create a new Point Feature Layer](https://developers.arcgis.com/layers/#/new/) with `Name` and `Sequence` fields at [developers.arcgis.com](https://developers.arcgis.com) and add data in ArcGIS Online (use your existing ArcGIS Online account or a free Developer Account).
* Upload a CSV file to ArcGIS Online. Be sure to include a `Name` and `Sequence` column and populate them appropriately. If the rows in the file have [suitable lat/lon or x/y fields](https://doc.arcgis.com/en/arcgis-online/reference/csv-gpx.htm#GUID-4EDCE12E-285E-41D0-A3B8-1BAB4B111922), this is free. Geocoding locations will consume credits.
* [Create an empty Feature Layer](https://doc.arcgis.com/en/arcgis-online/share-maps/publish-features.htm#ESRI_SECTION1_809F1266856546EF9E6D2CEF3816FD7D) from an [existing service URL](https://services.arcgis.com/OfH668nDRN7tbJh0/arcgis/rest/services/GlobalTourDemo1/FeatureServer/0) and populate the data in ArcGIS Online.
* Publish a layer to ArcGIS Online from ArcGIS Desktop.

## Samples
The following samples are included in this repo:

* 2D Sample with UI control (the UI is hidden while the animation progresses) [here](https://esri.github.io/geotour-js/samples/index2d.html) ([great circle version](https://esri.github.io/geotour-js/samples/index2d.html?forceGreatCircleArcs=true)).
* 3D Sample with UI control [here](https://esri.github.io/geotour-js/samples/index3d.html) ([great circle version](https://esri.github.io/geotour-js/samples/index3d.html?forceGreatCircleArcs=true)).
* Minimal 2D sample with property watching [here](https://esri.github.io/geotour-js/samples/simple.html) ([great circle version](https://esri.github.io/geotour-js/samples/simple.html?forceGreatCircleArcs=true)).
* Minimal 2D auto-starting sample [here](https://esri.github.io/geotour-js/samples/simple-autostart.html) ([great circle version](https://esri.github.io/geotour-js/samples/simple-autostart.html?forceGreatCircleArcs=true)).

## Advanced
Use the following additional options only if you really understand what you're doing. You'll probably have to dig in and get to learn what the code and data are really getting up to behind your back.

### URL Parameters

| Parameter           | Value |
| ------------------- | ----- |
| `routeResultServiceURL` | A URL to a service created from an ArcGIS Online Directions calculation. If this is provided, `stopLayerURL`, `stopNameField` and `stopSequenceField` are ignored. The demo tour (no parameters) is the equivalent of just providing this parameter with [this sample service](https://services.arcgis.com/OfH668nDRN7tbJh0/arcgis/rest/services/Connected_States_Service/FeatureServer). See [Creating a route service](#creating-a-route-service) below for more details. |
| `forceGreatCircleArcs` | Any value (but be a decent human being and use `true`) will force Great Circle lines to be drawn between stops in the case where detailed polylines are provided  with `routeResultServiceURL`. |

Both these advanced parameters may be provided in the URL as well as in the `Tour` constructor and can be specified in the `allowURLParameters` array.

### Creating a route service

Using the ArcGIS Online Map Viewer, you can create a Route Service that represents a set of directions between a sequence of points to use with the `routeResultServiceURL` parameter. Follow these steps (this will consume credits to generate the route and store the resulting service).

1. Calculate directions in the ArcGIS Map Viewer (if you have a Feature Service with up to 50 points, you can use that (see the [Tip at 3.c here](http://doc.arcgis.com/en/arcgis-online/get-started/get-directions.htm))).
2. Click the **Save** icon to save the result (you can give it a name and choose a folder).
3. Browse to the saved route's Portal Item page (there is a shortcut **SHARE THE ROUTE** link in the Directions panel once the route has been saved), and Publish it. This will create a new `Route layer (hosted)` item
4. Share the `Route layer (hosted)` item with `Everyone`.
5. Copy the `Route layer (hosted)` item's URL property from the right hand side of the Portal Item page. You can use this URL as the value for the `routeResultServiceURL` url parameter.

### Relative Paths in the dojoConfig
The [Usage](#usage) section above shows a fixed location for the component. But since it's not recommended to rely on GitHub as a CDN like this, the following code sets up dojo to load the component relative to the HTML file:

``` HTML
<script type="text/javascript">
// The location.pathname.substring() logic below may look confusing but all its doing is
// enabling us to load the api from a CDN and load local modules from the correct location.
var package_path = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
var dojoConfig = {
  packages: [{
    name: "geotour",
    location: package_path + '/src/js'
  }]
};
</script>
```

## Requirements

* [ArcGIS API for JavaScript](https://developers.arcgis.com/javascript/)

## Resources

* [ArcGIS Online Directions](http://doc.arcgis.com/en/arcgis-online/get-started/get-directions.htm)

## Issues

Find a bug or want to request a new feature? Please let us know by submitting an issue.  Thank you!

## Contributing

Anyone and everyone is welcome to contribute. Please see our [guidelines for contributing](https://github.com/esri/contributing).

## Licensing
Copyright 2016 Esri

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

A copy of the license is available in the repository's [license.txt](https://github.com/Esri/calcite-maps/blob/master/license.txt) file.
