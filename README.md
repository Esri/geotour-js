# Tour Map

This library takes a feature service of stops and animates great circle lines between them using the ArcGIS JavaScript API in either a 2D `MapView` or a 3D `SceneView`.

See a live version [here](https://nixta.github.io/tourmap/).

All it requires is a feature service with integer `Sequence` and string `Name` fields where records are to be visited in ascending `Sequence` order.

![TourMap](./tourmap.gif)

## Features

* Animate a tour between the stops stored in a Feature Layer.
* Works in 2D or 3D.
* Configuration via URL parameters.
* Watchable properties, in line with the 4.0 JavaScript API.

## Usage
Include the library by modifying `dojoConfig` before including the JS API (see the [Advanced] section below for your own deployments).

``` JavaScript
<script type="text/javascript">
var dojoConfig = {
  packages: [{
    name: "tour-map",
    location: 'https://nixta.github.io/tourmap/src/js'
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
  "tour-map/tour",
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
  var tour = new Tour(view, true);
});
```

The following samples are included:

* 2D Sample with UI control (the UI is hidden while the animation progresses) [here](https://nixta.github.io/tourmap/samples/index2d.html) ([great circle version](https://nixta.github.io/tourmap/samples/index2d.html?forceGreatCircleArcs=true)).
* 3D Sample with UI control [here](https://nixta.github.io/tourmap/samples/index3d.html) ([great circle version](https://nixta.github.io/tourmap/samples/index3d.html?forceGreatCircleArcs=true)).
* Minimal 2D sample with property watching [here](https://nixta.github.io/tourmap/samples/simple.html) ([great circle version](https://nixta.github.io/tourmap/samples/simple.html?forceGreatCircleArcs=true)).
* Minimal 2D auto-starting sample [here](https://nixta.github.io/tourmap/samples/simple-autostart.html) ([great circle version](https://nixta.github.io/tourmap/samples/simple-autostart.html?forceGreatCircleArcs=true)).


### Constructor
The constructor requires at least one parameter, the `MapView` or `SceneView` to animate the tour in. By default, the tour will load its data but will wait to be manually started:

``` JavaScript
  var tour = new Tour(view);
```

The second parameter is optional and can be `true` to force the animation to start immediately or an `integer` (in milliseconds) to start the animation after a delay:

``` JavaScript
  // Start as soon as the view has loaded.
  var tour = new Tour(view, true);
```

or

``` JavaScript
  // Start 2 seconds after the view finishes loading.
  var tour = new Tour(view, 2000);
```

### Animating the tour
By default, the tour will not start automatically (see the constructors above). Without passing a second parameter to force a start, you should wait until the tour is `ready` (that is, it has loaded all its data and is ready to start).

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
| extent | An [`Extent`](https://developers.arcgis.com/javascript/latest/api-reference/esri-geometry-Extent.html) object describing the bounds of the tour. |
| loadError | Will be `undefined` unless an error is encountered loading the tour data. |

### Tour methods
A `Tour` instance has the following methods:

| Method | Description |
| ------ | ----------- |
| `animate()` | Starts the tour animation and returns a [promise](https://developers.arcgis.com/javascript/latest/guide/working-with-promises/index.html) that is fulfilled when the animation ends. Call `cancel()` on this promise to abort the animation. |
| `animateWithDelay()` | Same as `animate()` but the first parameter is a delay in milliseconds before the animation begins. |
| `clearDisplay()` | When you start an animation, any graphics from a previous display of the tour are cleared. This function is useful if you need to clear the display without starting a new animation. |

### URL Parameters

By default a `Tour` instance will reference a demo dataset with a detailed real-world route. However, it will also scan the URL QueryString to override individual settings.

| Parameter           | Value |
| ------------------- | ----- |
| `stopLayerURL`    | The URL to a public Feature Service Layer containing points to tour between. See [Creating Data](#creating-data). |
| `stopNameField`     | Override the field to use for reading the point's name to display on the map (default `Name`). |
| `stopSequenceField` | Override the field to use for reading the point's sequence in the tour (default `Sequence`). |
| `duration` | Override the target duration of the entire animation in seconds (default 30s). This is an estimate but the component will try to meet the target. |

All parameters are optional. If no parameters are provided, a demo dataset is used (see the advanced `routeResultServiceURL` parameter). If a `stopLayerURL` is provided, the component will generate Great Circle Arcs between the stops.

### Creating data
There are many ways to create a Stop Service that you can pass to `stopLayerURL`. The key is to create a Feature Service Layer that meets the following criteria:

* Has Point Geometry.
* Has a `Name` field to display on the map.
* Has a `Sequence` field to determine the order the tour visits the points.
* Is public.

Here are some ways to create a suitable stop service:

* [Create a new Point Feature Layer](https://developers.arcgis.com/layers/#/new/) with `Name` and `Sequence` fields at [developers.arcgis.com](https://developers.arcgis.com) and add data in ArcGIS Online (use your existing ArcGIS Online account or a free Developer Account).
* Upload a CSV file to ArcGIS Online. Be sure to include a `Name` and `Sequence` column and populate them appropriately. If the rows in the file have [suitable lat/lon or x/y fields](https://doc.arcgis.com/en/arcgis-online/reference/csv-gpx.htm#GUID-4EDCE12E-285E-41D0-A3B8-1BAB4B111922), this is free. Geocoding locations will consume credits.
* [Create an empty Feature Layer](https://doc.arcgis.com/en/arcgis-online/share-maps/publish-features.htm#ESRI_SECTION1_809F1266856546EF9E6D2CEF3816FD7D) from an [existing service URL](http://services.arcgis.com/OfH668nDRN7tbJh0/arcgis/rest/services/GlobalTourDemo1/FeatureServer/0) and populate the data in ArcGIS Online.
* Publish a layer to ArcGIS Online from ArcGIS Desktop.

## Advanced
The following additional options require really understanding what you're doing. You'll probably have to dig in and understand what the code and data are really getting up to behind your back.
### URL Parameters

| Parameter           | Value |
| ------------------- | ----- |
| `routeResultServiceURL` | A URL to a service created from an ArcGIS Online Directions calculation. If this is provided, `stopLayerURL`, `stopNameField` and `stopSequenceField` are ignored. The demo tour (no parameters) is the equivalent of just providing this parameter with [this sample service](https://services.arcgis.com/OfH668nDRN7tbJh0/arcgis/rest/services/Oakland_to_Gloucester/FeatureServer).<br><br>**NOTE**: At the time of writing (July 9, 2016), a bug in ArcGIS Online's Web Map Viewer means only relatively simple/short routes can be saved this way (a fix is coming). It's recommended you don't try this at home until that ArcGIS Online bug is fixed, at which point this README will get updated with instructions for creating one of these. |
| `forceGreatCircleArcs` | Any value (but be a decent human being and use `true`) will force Great Circle lines to be drawn between stops in the case where detailed polylines are provided  with `routeResultServiceURL`. |

### Manual Configuration
If you are a masochist, you can also provide a full configuration object to the constructor as the second parameter. This must be a valid config object. Class level `Tour` methods are provided to obtain config objects for modification before passing to the constructor. This would be a good place to mention that pull requests are accepted:

| Class Method | Description |
| ------------ | ----------- |
| `defaultConfig()` | Return a default configuration object.|
| `getConfig()` | Return a default configuration object populated with any relevant URL parameters for the current page. |

If you pass a manually created configuration parameter, the component will not scan the Query String.

### Relative Paths in the DojoConfig
The [Usage](#usage) section above shows a fixed location for the component. But since it's not recommended to rely on GitHub as a CDN like this, the following code sets up dojo to load the library relative to the HTML file:

``` JavaScript
<script type="text/javascript">
// The location.pathname.substring() logic below may look confusing but all its doing is
// enabling us to load the api from a CDN and load local modules from the correct location.
var package_path = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
var dojoConfig = {
  packages: [{
    name: "tour-map",
    location: package_path + '/src/js'
  }]
};
</script>
```

## Requirements

* [ArcGIS API for JavaScript](https://developers.arcgis.com/javascript/)

## Resources

* [ArcGIS API for JavaScript](https://developers.arcgis.com/javascript/)

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

[](Esri Tags: Web Mapping ArcGIS JavaScript Animation)
[](Esri Language: JavaScript)