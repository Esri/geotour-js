define([
  "esri/layers/GraphicsLayer",
  "esri/renderers/SimpleRenderer",
  "esri/symbols/SimpleMarkerSymbol",
  "esri/symbols/SimpleLineSymbol",
  "esri/symbols/TextSymbol",
  "esri/Graphic",
  "esri/geometry/Polyline",
  "esri/geometry/geometryEngine",
  "esri/tasks/QueryTask",
  "esri/tasks/support/Query",
  "esri/core/watchUtils",
  "esri/core/Accessor",
  "dojo/promise/all",
  "dojo/Deferred",
  "dojo/_base/declare",
  "dojo/domReady!"
], 
function (GraphicsLayer, 
  SimpleRenderer, SimpleMarkerSymbol, SimpleLineSymbol, TextSymbol, 
  Graphic, Polyline, geometryEngine,
  QueryTask, Query,
  watchUtils, Accessor,
  all, Deferred, declare)
{

  var tourClass = Accessor.createSubclass({
    properties: {
      ready: false,
      extent: undefined,
      loadError: undefined
    },
    constructor: function(mapView, configOrAutoStart) {
      this.view = mapView;

      // Figure out the second parameter. Bool, time delay, or full config?
      if (typeof configOrAutoStart === "boolean") {
        this.tourConfig = loadTourConfig();
        this.tourConfig.autoStart = configOrAutoStart;
      } else if (typeof configOrAutoStart === "number") {
        this.tourConfig = loadTourConfig();
        this.tourConfig.autoStart = true;
        this.tourConfig.autoStartDelay = configOrAutoStart;
      } else {
        this.tourConfig = configOrAutoStart || loadTourConfig();
      }

      this.hops = [];

      // Set up some layers to show the animation
      this.hopsGraphicsLayer = new GraphicsLayer({
        renderer: new SimpleRenderer({
          symbol: this.tourConfig.symbols.tour
        })
      });
      this.stopsGraphicsLayer = new GraphicsLayer({
        renderer: new SimpleRenderer({
          symbol: this.tourConfig.symbols.stops
        })
      });

      // Calculate how long each hop should animate.
      this.hopAnimationDuration = this.tourConfig.animation.duration / (Math.max(1, this.hops.length));

      if (this.tourConfig.spatialReference) {
        // User can override the spatialReference directly, so we don't have
        // to wait for the view to read it.
        loadTour.bind(this)();
      } else {
        // Otherwise, wait for the view to load so we can use its Spatial Reference.
        watchUtils.whenTrueOnce(this.view, "ready", function() {
          this.tourConfig.spatialReference = this.view.spatialReference;
          loadTour.bind(this)();
        }.bind(this));        
      }

      if (this.tourConfig.autoStart) {
        // One we're ready and the view has stopped updating, animate.
        watchUtils.whenTrueOnce(this, "ready", function () {
          watchUtils.whenFalseOnce(this.view, "updating", function () {
            this.animateWithDelay(this.tourConfig.autoStartDelay);
          }.bind(this));
        }.bind(this));
      }
    },
  	animate: animateTour,
    animateWithDelay: function(delay) {
      window.setTimeout(animateTour.bind(this), delay || 500);
    },
    clearDisplay: clearTourGraphics
	});

  // Provide a Class Level method to read default config.
  tourClass.getConfig = loadTourConfig;
  tourClass.defaultConfig = getDefaultConfig;

  return tourClass;

  function clearTourGraphics() {
    this.hopsGraphicsLayer.removeAll();
    this.stopsGraphicsLayer.removeAll();
  }

  function loadTour() {
    this.view.map.addMany([
      this.hopsGraphicsLayer,
      this.stopsGraphicsLayer
    ]);

    // Create query task to load the stops
    var stopQueryTask = new QueryTask({
      url: this.tourConfig.data.stopServiceURL
    });

    // Make sure we get back the attributes we need, and order appropriately
    var stopQuery = new Query({
      returnGeometry: true,
      outFields: [this.tourConfig.data.stopNameField, this.tourConfig.data.stopSequenceField],
      where: "1=1",
      orderByFields: [this.tourConfig.data.stopSequenceField],
      outSpatialReference: this.tourConfig.spatialReference
    });

    // Perform query for stops
    var queries = [stopQueryTask.execute(stopQuery)];

    // If we were given a feature service of Route Directions (from saving an ArcGIS Online Directions result),
    // then also load that.
    if (this.tourConfig.useActualRoute) {
      var trackQueryTask = new QueryTask({
        url: this.tourConfig.data.trackServiceURL
      });

      var trackQuery = new Query({
        returnGeometry: true,
        where: "1=1",
        orderByFields: [this.tourConfig.data.trackSequenceField],
        outSpatialReference: this.tourConfig.spatialReference
      });

      queries.push(trackQueryTask.execute(trackQuery));
    }

    // When stops and directions (if appropriate) have been loaded, parse the data and get ready to animate.
	  all(queries).then(function(results) {
      var stopFeatures = results[0].features;
      if (stopFeatures.length === 0) {
        loadDeferred.reject("No stops were returned to show a map between!");
        return;
      } else {
        var sampleFeature = stopFeatures[0],
            looksOk = true;
        if (!sampleFeature.attributes.hasOwnProperty(this.tourConfig.data.stopNameField)) {
          loadDeferred.reject("The data returned for the stops doesn't seem to have a " + this.tourConfig.data.stopNameField + " field!");
          looksOk = false;
        }
        if (!sampleFeature.attributes.hasOwnProperty(this.tourConfig.data.stopSequenceField)) {
          loadDeferred.reject("The data returned for the stops doesn't seem to have a " + this.tourConfig.data.stopSequenceField + " field!");
          looksOk = false;
        }

        if (!looksOk) return;
      }

      var trackGeoms = results.length > 1 ? getTrackGeoms(results[1].features) : undefined;

      // Parse the data, and prepare the data for animation
      this.hops = parseHops.bind(this)(stopFeatures, trackGeoms);

      this.hopAnimationDuration = this.tourConfig.animation.duration / (Math.max(1, this.hops.length));

      this.extent = geometryEngine.union(this.hops.map(function(hop) {
        return hop.line.extent;
      })).extent;

      this.ready = true;

      return;
	  }.bind(this), function (err) {
	    console.error("Something went wrong querying the stops or routes services. Check your URL parameters.\n\nMore details in the browser console.");
	    console.error(err);

      this.loadError = err;

	    return;
	  });
  }

  function animateTour() {
    var deferred = new Deferred();

    // Clear any existing routes
    this.clearDisplay();

    // Set up some graphics and geometries to work with.
    var completedHopsLine, completedHopsGraphic, currentHopLine, currentHopGraphic;

    watchUtils.whenTrueOnce(this.view, "ready", function() {
      completedHopsLine = new Polyline({
        spatialReference: this.tourConfig.spatialReference
      });
      completedHopsGraphic = new Graphic({
        geometry: completedHopsLine
      });
      currentHopLine = new Polyline({
        spatialReference: this.tourConfig.spatialReference
      });
      currentHopGraphic = new Graphic({
        geometry: currentHopLine
      });

      // And start the animation
      window.requestAnimationFrame(updateAnimation.bind(this));
    }.bind(this));

    var start,
        currentIndex = 0;

    return deferred;

    function updateAnimation(timeStamp) {
    	if (deferred.isCanceled()) {
    		deferred.reject("Tour cancelled by user.");
    		return;
    	}

      // Let's figure out where we should be in the animation for this timestamp.
      var currentHopInfo = this.hops[currentIndex];

      if (!start) {
        // If we just started a hop, we remember this timestamp.
        start = timeStamp;
        if (currentIndex == 0) {
          // For the first hop only, also show the origin.
          showStop(currentHopInfo.origin, this.stopsGraphicsLayer, this.tourConfig);
        }
      }

      // Get as much line as we need for as far through this hop's animation as we are
      var hopProgress = Math.min(1, (timeStamp - start) / (this.hopAnimationDuration * 1000)),
          subLine = getSubline(currentHopInfo.geodesicLine, hopProgress);

      // Update the map. We need to create a new Graphic. Just updating the geometry doesn't do it.
      this.hopsGraphicsLayer.remove(currentHopGraphic);
      currentHopGraphic = new Graphic({ geometry: subLine })
      this.hopsGraphicsLayer.add(currentHopGraphic);

      // If we reached the end of a hop, display the stop that's at the end of it and move on to the next hop.
      if (hopProgress == 1) {
        // First update the overall "completed hops" polyline.
        for (var p=0; p < subLine.paths.length; p++) {
          completedHopsLine.addPath(subLine.paths[p]);
        }

        // And update the map to reflect this. We now have one line on the map
        this.hopsGraphicsLayer.remove(currentHopGraphic);
        this.hopsGraphicsLayer.remove(completedHopsGraphic);
        completedHopsGraphic = new Graphic({ geometry: completedHopsLine });
        this.hopsGraphicsLayer.add(completedHopsGraphic);

        // Show the stop we just reached.
        showStop(currentHopInfo.destination, this.stopsGraphicsLayer, this.tourConfig);

        // Move on to the next hop and reset the timing info
        currentIndex += 1;
        start = undefined;

        deferred.progress({
        	currentHop: currentIndex,
        	totalHops: this.hops.length
        });
      }

      // Check if we're done. If we are, good, resolve the deferred and get outta here. Otherwise, repeat when the next animation opportunity comes up.
      if (currentIndex < this.hops.length) {
        window.requestAnimationFrame(updateAnimation.bind(this)); 
      } else {
        deferred.resolve();
      }
    }
  }

  /// Data Visualization
  function showStop(stop, stopsGraphicsLayer, tourConfig) {
    stopsGraphicsLayer.add(stop);
    stopsGraphicsLayer.add(labelForStop(stop, tourConfig));
  }

  function labelForStop(stop, tourConfig) {
    var yOffset = stop.attributes.__label_yOffset || 0;
    var alignment = stop.attributes.__label_alignment || "center";

    var labelGraphic = new Graphic({
      geometry: stop.geometry,
      symbol: new TextSymbol({
        color: "white",
        haloColor: "black",
        haloSize: "3px",
        text: stop.attributes[tourConfig.data.stopNameField],
        xoffset: 0,
        yoffset: yOffset,
        horizontalAlignment: alignment,
        font: {  // autocast as esri/symbols/Font
          size: 12,
          family: "sans-serif",
          weight: "light"
        }
      })
    });

    return labelGraphic;
  }

  /// Track Parsing
  function getTrackGeoms(allRouteGraphics) {
    var trackHops = [],
        currentHop = [],
        onHop = false,
        firstGeom;

    for (var i=0; i<allRouteGraphics.length; i++) {
      var graphic = allRouteGraphics[i];
      if (!firstGeom) {
        firstGeom = graphic.geometry;
      }

      if (!onHop && graphic.geometry !== null) {
        // Start a new hop
        currentHop = [];
        onHop = true;
      } else if (onHop && graphic.geometry === null) {
        // Finish a hop
        var hopGeom = new Polyline( { 
          paths: currentHop.reduce(function (a,b) { return a.concat(b); }),
          spatialReference: firstGeom.spatialReference } );
        trackHops.push(hopGeom);
        onHop = false;
      }

      if (onHop) {
        currentHop.push(graphic.geometry.paths);
      }
    }

    return trackHops;
  }

  /// Stop and Track Parsing
  function parseHops(stopFeatures, trackFeatures) {
    var hops = [];
    var hopCount = Math.max(stopFeatures.length-1, 1);
    var hopAnimationDuration = this.tourConfig.animation.duration / hopCount,
        framesPerHop = hopAnimationDuration * this.tourConfig.animation.maxFPS;

    var labelConfig = this.tourConfig.labelPositions;

    var previousStop = undefined;
    for (var i=0; i < stopFeatures.length; i++) {
      var stop = stopFeatures[i];

      var stopSequence = stop.attributes.Sequence,
          yOffset = (labelConfig.offsetBelow.indexOf(stopSequence) > -1) ? -14 : 7,
          alignment = (labelConfig.leftAlign.indexOf(stopSequence) > -1) ? "left" : 
                        ((labelConfig.rightAlign.indexOf(stopSequence) > -1) ? "right" : "center");

      stop.attributes["__label_yOffset"] = yOffset;
      stop.attributes["__label_alignment"] = alignment;

      if (previousStop !== undefined) {
        var prevPoint = previousStop.geometry,
            currPoint = stop.geometry;

        var hopLine, geodesicHopLine;

        if (this.tourConfig.useActualRoute) {
          hopLine = trackFeatures[i-1];
          geodesicHopLine = hopLine;
        } else {
          hopLine = new Polyline({
            paths: [[prevPoint.x, prevPoint.y], [currPoint.x, currPoint.y]],
            spatialReference: this.view.spatialReference
          });
          
          var hopLength = geometryEngine.geodesicLength(hopLine, "miles"),
              densifyLength = hopLength / framesPerHop;

          geodesicHopLine = geometryEngine.geodesicDensify(hopLine, densifyLength, "miles");
        }

        var newHop = {
          origin: previousStop,
          destination: stop,
          line: hopLine,
          geodesicLine: geodesicHopLine
        };
        hops.push(newHop);
      }

      previousStop = stop;
    }

    return hops;
  }

  /// Polyline clipping
  function getSubline(sourceLine, portionToReturn) {
    // We'll do all the maths in planar coordinates (i.e. any geodesic work has aleady been done).
    // We also assume we're dealing with Web Mercator and so distances are in meters.
    var lineLength = geometryEngine.planarLength(sourceLine, "meters"),
        targetLength = lineLength * portionToReturn,
        targetPaths = [],
        cumulativeLength = 0;

    // Go over all the paths. They must be in order.
    for (var pathIndex=0; pathIndex < sourceLine.paths.length; pathIndex++) {
      var path = sourceLine.paths[pathIndex];

      var p, tailVertex;
      for (p=0; p < path.length-1; p++) {
        // Get the gap between this vertex and the next. We're assuming Web Mercator and meters here.
        var vertexGap = Math.sqrt(Math.pow(path[p+1][0]-path[p][0],2)+Math.pow(path[p+1][1]-path[p][1],2));
        cumulativeLength += vertexGap;

        if (cumulativeLength == targetLength) {
          // This'll probably happen IRL: if the length up to this vertex on the path happens to be
          // EXACTLY what we were looking for, then let's just gobble that up and stop.
          tailVertex = path[p+1];
          break;
        } else if (cumulativeLength > targetLength) {
          // Much more likely: Somewhere between this vertex and the next, we'll reach the target length.
          // So create a new vertex part way along, and we'll gobble the path up to there.
          var lengthToThisVertex = cumulativeLength - vertexGap,
              targetGapRatio = (targetLength - lengthToThisVertex) / vertexGap,
              thisVertex = path[p],
              nextVertex = path[p+1];
          tailVertex = [
            thisVertex[0] + ((nextVertex[0] - thisVertex[0]) * targetGapRatio), 
            thisVertex[1] + ((nextVertex[1] - thisVertex[1]) * targetGapRatio)
          ];
          break;
        }
      }

      if (p < path.length-1) {
        // We got as much line as we needed.
        var partialPath = path.slice(0,p);
        partialPath.push(tailVertex);
        targetPaths.push(partialPath);
        break;
      } else {
        // Not there yet. Add the whole path and try the next one.
        targetPaths.push(path);
      }
    }

    // Generate a polyline of the paths and partial last path that make up a sub-line to that length.
    var subLine = new Polyline({
      paths: targetPaths,
      spatialReference: sourceLine.spatialReference
    })

    return subLine;
  }

  /// Visual Hop-by-hop debug
  /// Be sure to change the CSS to show the "hopsDiv" and change the "mainArea" right margin.
  function addHopsMaps(hops) {
    for (var i=0; i < hops.length; i++) {
      var hop = hops[i];
      addMapForHop(hop);
    }
  }

  function addMapForHop(hop) {
    var newDiv = document.createElement("div");
    newDiv.id = (hop.origin.attributes[tourConfig.data.stopNameField] + " to " + hop.destination.attributes[tourConfig.data.stopNameField]).replace(" ","_");
    newDiv.className = "hopMap";
    var hopsDiv = document.getElementById("hopsDiv");
    hopsDiv.insertAdjacentElement("beforeend", newDiv);
    var hopsLayer = new GraphicsLayer({ renderer: hopsGraphicsLayer.renderer }),
        stopsLayer = new GraphicsLayer({ renderer: stopsGraphicsLayer.renderer }),
        overallLayer = new GraphicsLayer({ renderer: hopsLayer.renderer.clone() }),
        hopMap = new Map({
          basemap: map.basemap,
          layers: [
            overallLayer,
            hopsLayer,
            stopsLayer
          ]
        }),
        hopView = new MapView({
          container: newDiv.id,
          map: hopMap,
          extent: hop.geodesicLine.extent.clone().expand(1.6)
        });

    overallLayer.renderer.symbol.color = [0,255,0];

    watchUtils.whenTrueOnce(hopView, "ready", function () {
      showStop(hop.origin.clone(), stopsLayer, this.tourConfig);
      showStop(hop.destination.clone(), stopsLayer, this.tourConfig);
      hopsLayer.add(new Graphic({ geometry: hop.geodesicLine.clone() }));
    });

    hopViews.push({view: hopView, map: hopMap});
  }

  function getDefaultConfig() {
    return {
      useActualRoute: false,
      autoStart: false,
      autoStartDelay: 0,
      spatialReference: null,
      data: {
        stopServiceURL: null,
        stopLayerID: 1,
        stopNameField: "Name",
        stopSequenceField: "Sequence",
        trackServiceURL: null,
        trackLayerID: 3,
        trackSequenceField: "Sequence"
      },
      animation: {
        duration: 30.0,
        maxFPS: 30
      },
      symbols: {
        tour: new SimpleLineSymbol({
          color: [255,0,0, 1],
          width: 3
        }),
        stops: new SimpleMarkerSymbol({
          style: "circle",
          color: [194,194,194,0.5],
          size: "10px",  // pixels
          outline: {  // autocasts as esri/symbols/SimpleLineSymbol
            color: [153,153,153],
            width: 1.125  // points
          }
        })
      },
      labelPositions: {
        // Populate these with the sequence numbers of stops whose labels 
        // should not be placed at the default 0 y offset and horizontally centered.
        offsetBelow: [],
        leftAlign: [],
        rightAlign: []
      }
    };
  }

  function loadTourConfig() {
    var config = getDefaultConfig();

    var routeServiceURL = getParameterByName("agolRouteResultURL");

    if (routeServiceURL) {
      config.data.stopServiceURL = routeServiceURL + "/" + config.data.stopLayerID;
      if (!getParameterByName("forceGreatCircleArcs")) {
        config.data.trackServiceURL = routeServiceURL + "/" + config.data.trackLayerID;
      }
    } else {
      config.data.stopServiceURL = getParameterByName("stopServiceURL") || config.data.stopServiceURL;
      config.data.stopNameField = getParameterByName("stopNameField") || config.data.stopNameField;
      config.data.stopSequenceField = getParameterByName("stopSequenceField") || config.data.stopSequenceField;
    }

    if (config.data.stopServiceURL === null && !routeServiceURL) {
      // Populate some demo defaults.
      console.warn("No 'stopServiceURL' or 'agolRouteResultURL' provided. Using default demo service: https://services.arcgis.com/OfH668nDRN7tbJh0/arcgis/rest/services/Oakland_to_Gloucester/FeatureServer");
      routeServiceURL = "https://services.arcgis.com/OfH668nDRN7tbJh0/arcgis/rest/services/Oakland_to_Gloucester/FeatureServer";
      config.data.stopServiceURL = routeServiceURL + "/" + config.data.stopLayerID;
      if (!getParameterByName("forceGreatCircleArcs")) {
        config.data.trackServiceURL = routeServiceURL + "/" + config.data.trackLayerID;
      }
      config.labelPositions = {
        offsetBelow: [3,4,9,13,17,19,20,23,25,30,42],
        leftAlign: [1,5,6,11,15,22,23,24,27,33,38,42,44],
        rightAlign: [8,16,17,18,19,21,28,30,34,35,36,37,39,40,43]
      }
    }

    // Figure out if we're going to follow a polyline route or just great circle between each stop
    config.useActualRoute = config.data.trackServiceURL !== null;

    return config;
  }

  function getParameterByName(name) {
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        url = window.location.href,
        results = regex.exec(url);
    if (!results) return undefined;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
  }

});
