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
  "esri/views/View",
  "dojo/promise/all",
  "dojo/Deferred",
  "dojo/_base/declare",
  "dojo/domReady!"
], 
function (GraphicsLayer, 
  SimpleRenderer, SimpleMarkerSymbol, SimpleLineSymbol, TextSymbol, 
  Graphic, Polyline, geometryEngine,
  QueryTask, Query,
  watchUtils, Accessor, View,
  all, Deferred, declare)
{
  var demoRouteServiceURL = "https://services.arcgis.com/OfH668nDRN7tbJh0/arcgis/rest/services/Connected_States_Service/FeatureServer";

  ///
  /// Top level Tour class
  ///
  var tourClass = Accessor.createSubclass({
    properties: {
      ready: false,
      extent: undefined,
      loadError: undefined
    },
    constructor: function(mapViewOrConfig) {
      // Parse the input
      this._initViewAndConfig(mapViewOrConfig);

      // Inialize working data
      this.hops = [];

      // Initilize animation layers
      this._initMapLayers();

      // Initialize the animation
      this._initAnimation();

      // Load the tour data ready to animate.
      this._initTour();
    },
    animate: function() {
      return _animateTour(this);
    },
    animateWithDelay: function(delay) {
      return _animateTour(this, delay || 500);
    },
    clearDisplay: function() {
      _clearTourGraphics(this);
    },
    _initTour: function() {
      if (this.tourConfig.spatialReference) {
        // User can override the spatialReference directly, so we don't have
        // to wait for the view to read it.
          _loadTour(this);
      } else {
        // Otherwise, wait for the view to load so we can use its Spatial Reference.
        watchUtils.whenTrueOnce(this.view, "ready", function() {
          this.tourConfig.spatialReference = this.view.spatialReference;
          try {
            _loadTour(this);
          } catch (err) {
            console.error(err);
            this.loadError = err;
            return;
          }
        }.bind(this));
      }
    },
    _initViewAndConfig: function(mapViewOrConfig) {
      // Can either pass in a MapView/SceneView and a boolean/integer,
      // Or an object with at least a "view" property.
      var mapView, config = {};
      if (typeof mapViewOrConfig.isInstanceOf === "function") {
        mapView = mapViewOrConfig;
      } else {
        config = mapViewOrConfig;
        mapView = config.view;
        delete config.view;
      }

      if (!mapView.isInstanceOf(View)) {
        throw "You must pass a MapView or SceneView as either the first parameter, or a 'view' property of the first parameter object.";
      }

      this.view = mapView;

      if (typeof config === "object") {
        this.tourConfig = readConfig(config);
      } else {
        throw "You must pass a MapView, SceneView, or JSON Configuration Object as the first parameter!";
      }
    },
    _initMapLayers: function() {
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
    },
    _initAnimation: function() {
      // Calculate how long each hop should animate.
      this.hopAnimationDuration = this.tourConfig.animation.duration / (Math.max(1, this.hops.length));

      if (this.tourConfig.autoStart) {
        // One we're ready and the view has stopped updating, animate.
        watchUtils.whenTrueOnce(this, "ready", function () {
          watchUtils.whenFalseOnce(this.view, "updating", function () {
            this.animateWithDelay(this.tourConfig.autoStartDelay);
          }.bind(this));
        }.bind(this));
      }
    }
  });

  return tourClass;




  ///
  /// LOAD THE TOUR DATA
  ///
  function _loadTour(tour) {
    // Make sure we're cleared up
    tour.ready = false;
    tour.extent = undefined;
    tour.loadError = undefined;

    all(_getTourQueries(tour.tourConfig)).then(function(results) {
      // When stops and directions (if appropriate) have been loaded, parse the data and get ready to animate.
      _parseTour(tour, results);

      // OK. We're ready to animate.
      tour.ready = true;
    }, function (err) {
      console.error("Something went wrong querying the stops or routes services. Check your URL parameters.\n\nMore details in the browser console.");
      console.error(err);

      tour.loadError = err;
    });
  }




  ///
  /// DATA QUERY LOGIC
  ///
  function _getTourQueries(config) {
    // Return a set of promises on queries to load the data for the current configuration parameters

    // Validate some stuff
    if (!config.data.stopLayerURL) {
      throw "Cannot read stops! stopLayerURL = " + config.data.stopLayerURL;
    }

    // Create query task to load the stops
    var stopQueryTask = new QueryTask({
      url: config.data.stopLayerURL
    });

    // Make sure we get back the attributes we need, and order by stop sequence
    var stopQuery = new Query({
      returnGeometry: true,
      outFields: [config.data.stopNameField, config.data.stopSequenceField],
      where: "1=1",
      orderByFields: [config.data.stopSequenceField],
      outSpatialReference: config.spatialReference
    });

    // Perform query for stops
    var promises = [stopQueryTask.execute(stopQuery)];

    // If we were given a feature service of Route Directions (from saving an ArcGIS Online Directions result),
    // then also load that.
    if (config.useActualRoute) {
      var trackQueryTask = new QueryTask({
        url: config.data.trackServiceURL
      });

      var trackQuery = new Query({
        returnGeometry: true,
        outFields: [config.data.trackSequenceField],
        where: "1=1",
        orderByFields: [config.data.trackSequenceField],
        outSpatialReference: config.spatialReference
      });

      promises.push(trackQueryTask.execute(trackQuery));
    }

    return promises;
  }

  function _parseTour(tour, results) {
    // Parse the query responses 
    var stopFeatures = results[0].features;

    if (!validateStops(stopFeatures, tour.tourConfig)) {
      tour.loadError = "Error processing data from query results. Check browser console for more information.";
      return;
    }

    var hopGeometries = results.length > 1 ? getHopGeometries(tour.tourConfig, results[1].features) : undefined;

    // Parse the data, and prepare the data for animation
    tour.hops = parseHops(tour, stopFeatures, hopGeometries);

    // How long should each hop take?
    tour.hopAnimationDuration = tour.tourConfig.animation.duration / (Math.max(1, tour.hops.length));

    // Where is the tour?
    tour.extent = geometryEngine.union(tour.hops.map(function(hop) {
      return hop.line.extent;
    })).extent;

    // Add layers to display the tour.
    tour.view.map.addMany([
      tour.hopsGraphicsLayer,
      tour.stopsGraphicsLayer
    ]);
  }

  function validateStops(stopFeatures, config) {
    var looksOk = true;

    // Do some input validation
    if (stopFeatures.length === 0) {
      console.error("No stops were returned to show a map between!");
      looksOk = false;
    } else {
      var sampleFeature = stopFeatures[0];
      if (!sampleFeature.attributes.hasOwnProperty(config.data.stopNameField)) {
        console.error("The data returned for the stops doesn't seem to have a '" + config.data.stopNameField + "' field!");
        looksOk = false;
      }
      if (!sampleFeature.attributes.hasOwnProperty(config.data.stopSequenceField)) {
        console.error("The data returned for the stops doesn't seem to have a '" + config.data.stopSequenceField + "' field!");
        looksOk = false;
      }
    }

    return looksOk;
  }



  ///
  /// PARSE TOUR DATA
  ///
  function parseHops(tour, stopFeatures, hopGeometries) {
    // Stop and Track Parsing
    var hops = [];
    var hopCount = Math.max(stopFeatures.length-1, 1);
    var hopAnimationDuration = tour.tourConfig.animation.duration / hopCount,
        framesPerHop = hopAnimationDuration * tour.tourConfig.animation.maxFPS;

    var labelConfig = tour.tourConfig.labelPositions;

    var previousStop = undefined;
    for (var i=0; i < stopFeatures.length; i++) {
      var stop = stopFeatures[i];

      var stopSequence = stop.attributes.Sequence,
          yOffset = ((labelConfig.offsetBelow || []).indexOf(stopSequence) > -1) ? -14 : 7,
          alignment = ((labelConfig.leftAlign || []).indexOf(stopSequence) > -1) ? "left" : 
                        (((labelConfig.rightAlign || []).indexOf(stopSequence) > -1) ? "right" : "center");

      stop.attributes["__label_yOffset"] = yOffset;
      stop.attributes["__label_alignment"] = alignment;

      if (previousStop !== undefined) {
        var prevPoint = previousStop.geometry,
            currPoint = stop.geometry;

        var hopLine, geodesicHopLine;

        if (tour.tourConfig.useActualRoute) {
          hopLine = hopGeometries[i-1];
          geodesicHopLine = hopLine;
        } else {
          hopLine = new Polyline({
            paths: [[prevPoint.x, prevPoint.y], [currPoint.x, currPoint.y]],
            spatialReference: tour.view.spatialReference
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

  function getHopGeometries(config, allRouteGraphics) {
    // Build an array of "Hops". The route consists of "Stops", and "Hops" between them.
    // A "Hop" is a sequence of coordinates that make up the path between one stop and another.
    var trackHops = [],
        currentHop = [],
        sr,
        lastPointID = -1;

    for (var i=0; i<allRouteGraphics.length; i++) {
      var graphic = allRouteGraphics[i],
          pointID = graphic.attributes[config.data.trackSequenceField];

      if (!sr) {
        sr = graphic.geometry.spatialReference;
      }

      if (i == (allRouteGraphics.length-1) || pointID > lastPointID + 1) {
        // A break in the sequence numbers means we've just reached a stop.
        if (currentHop.length > 0) {
          // Finish a hop
          var hopGeom = new Polyline( { 
            paths: currentHop.reduce(function (a,b) { return a.concat(b); }),
            spatialReference: sr } );
          trackHops.push(hopGeom);
        }

        // Start a new hop
        currentHop = [];
      }

      currentHop.push(graphic.geometry.paths);
      lastPointID = pointID;
    }

    return trackHops;
  }




  ///
  /// TOUR ANIMATION
  ///
  function _animateTour(tour, delay) {
    var deferred = new Deferred();

    // Clear any existing routes
    tour.clearDisplay();

    // Set up some graphics and geometries to work with.
    var completedHopsLine, completedHopsGraphic, currentHopLine, currentHopGraphic;

    window.setTimeout(function() {
      watchUtils.whenTrueOnce(tour, "ready", function () {
        watchUtils.whenTrueOnce(tour.view, "ready", function() {
          // Waiting here is a little redundant but safe in case anyone calls animate() before we're ready.
          completedHopsLine = new Polyline({
            spatialReference: tour.tourConfig.spatialReference
          });
          completedHopsGraphic = new Graphic({
            geometry: completedHopsLine
          });
          currentHopLine = new Polyline({
            spatialReference: tour.tourConfig.spatialReference
          });
          currentHopGraphic = new Graphic({
            geometry: currentHopLine
          });

          // And start the animation
          window.requestAnimationFrame(updateAnimation);
        });
      });
    }, delay || 0);


    var targetHopDuration = 1000 * tour.hopAnimationDuration;

    var currentIndex = 0, frameCount = 0, totalFrameTime = 0;
    var averageFramePeriod = averageFrameDuration = 1000/60;

    var overallStartTime, hopEndTargetTime;

    return deferred;

    function updateAnimation(timeStamp) {
      var frameStartTime = performance.now();

      if (deferred.isCanceled()) {
        deferred.reject("Tour cancelled by user.");
        return;
      }

      // Let's figure out where we should be in the animation for this timestamp.
      var currentHopInfo = tour.hops[currentIndex];

      if (overallStartTime) {
        averageFramePeriod = (frameStartTime - overallStartTime) / frameCount;
        averageFrameDuration = totalFrameTime / frameCount;
      } else {
        overallStartTime = frameStartTime;
        hopEndTargetTime = overallStartTime + targetHopDuration;

        // For the first hop only, also show the origin.
        showStop(currentHopInfo.origin, tour.stopsGraphicsLayer, tour.tourConfig);
      }

      var framesRemainingInHop = (hopEndTargetTime - frameStartTime)/averageFramePeriod,
          forceCompleteOnThisFrame = framesRemainingInHop < 0.5;

      // Get as much line as we need for as far through this hop's animation as we are
      var hopTimeRemaining = hopEndTargetTime - frameStartTime;
      var uncorrectedHopProgress = 1-(hopTimeRemaining / targetHopDuration),
          hopProgress = forceCompleteOnThisFrame ? 1 : Math.min(1, uncorrectedHopProgress),
          subLine = getSubline(currentHopInfo.geodesicLine, hopProgress);

      // Update the map. We need to create a new Graphic. Just updating the geometry doesn't do it.
      tour.hopsGraphicsLayer.remove(currentHopGraphic);
      currentHopGraphic = new Graphic({ geometry: subLine })
      tour.hopsGraphicsLayer.add(currentHopGraphic);

      // If we reached the end of a hop, display the stop that's at the end of it and move on to the next hop.
      if (hopProgress == 1) {
        // First update the overall "completed hops" polyline.
        for (var p=0; p < subLine.paths.length; p++) {
          completedHopsLine.addPath(subLine.paths[p]);
        }

        // And update the map to reflect this. We now have one line on the map
        tour.hopsGraphicsLayer.remove(currentHopGraphic);
        tour.hopsGraphicsLayer.remove(completedHopsGraphic);
        completedHopsGraphic = new Graphic({ geometry: completedHopsLine });
        tour.hopsGraphicsLayer.add(completedHopsGraphic);

        // Show the stop we just reached.
        showStop(currentHopInfo.destination, tour.stopsGraphicsLayer, tour.tourConfig);

        // Move on to the next hop and reset the timing info
        currentIndex++;
        hopEndTargetTime = performance.now() + targetHopDuration;

        deferred.progress({
          currentHop: currentIndex,
          totalHops: tour.hops.length
        });
      }

      var frameEndTime = performance.now();
      totalFrameTime += (frameEndTime - frameStartTime);
      frameCount++;

      // Check if we're done. If we are, good, resolve the deferred and get outta here. Otherwise, repeat when the next animation opportunity comes up.
      if (currentIndex < tour.hops.length) {
        window.requestAnimationFrame(updateAnimation); 
      } else {
        var overallEndTime = frameEndTime;
        console.log("Total animation took " + (overallEndTime - overallStartTime)/1000 + " seconds (Average Frame Period: " + averageFramePeriod + "ms and Duration: " + averageFrameDuration + "ms)");
        deferred.resolve();
      }
    }
  }




  ///
  /// TOUR ANIMATION VISUALISATION
  ///
  function _clearTourGraphics(tour) {
    tour.hopsGraphicsLayer.removeAll();
    tour.stopsGraphicsLayer.removeAll();
  }

  function showStop(stop, stopsGraphicsLayer, config) {
    stopsGraphicsLayer.add(stop);
    stopsGraphicsLayer.add(labelForStop(stop, config));
  }

  function labelForStop(stop, config) {
    var yOffset = stop.attributes.__label_yOffset || 0;
    var alignment = stop.attributes.__label_alignment || "center";

    var labelSymbol = config.symbols.labels.clone();
    labelSymbol.text = stop.attributes[config.data.stopNameField];
    labelSymbol.horizontalAlignment = alignment;
    labelSymbol.yoffset = yOffset;

    var labelGraphic = new Graphic({
      geometry: stop.geometry,
      symbol: labelSymbol
    });

    return labelGraphic;
  }




  ///
  /// POLYLINE CLIPPING
  ///
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




  ///
  /// TOUR CONFIGURATION
  ///
  function getDefaultConfig() {
    return {
      useActualRoute: undefined,
      autoStart: false,
      autoStartDelay: 0,
      spatialReference: null,
      data: {
        stopLayerURL: null,
        stopLayerID: 1,
        stopNameField: "Name",
        stopSequenceField: "Sequence",
        trackServiceURL: null,
        trackLayerID: 3,
        trackSequenceField: "DirectionPointID"
      },
      animation: {
        duration: 30.0,
        maxFPS: 30 // Used when generating Great Circles to estimate a sensible min distance between points.
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
        }),
        labels: new TextSymbol({
          color: "white",
          haloColor: "black",
          haloSize: "3px",
          xoffset: 0,
          font: {  // autocast as esri/symbols/Font
            size: 12,
            family: "sans-serif",
            weight: "light"
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

  function getUrlParameterMappingForValidParams() {
    // The JSON Config object has a hierarchical structure.
    // This determines how the URL parameters should be read into that structure.
    return {
      autoStart: { 
        path: "autoStart", 
        urlValid: true,
        mapFunc: mapBool
      },
      autoStartDelay: { 
        path: "autoStartDelay",
        urlValid: true,
        mapFunc: mapInt
      },
      duration: { 
        path: "animation.duration",
        urlValid: true,
        mapFunc: mapFloat
      },
      stopLayerURL: { 
        path: "data.stopLayerURL", 
        urlValid: true
      },
      stopNameField: { 
        path: "data.stopNameField",
        urlValid: true
      },
      stopSequenceField: { 
        path: "data.stopSequenceField",
        urlValid: true
      },

      routeResultServiceURL: {
        path: "routeResultServiceURL",
        urlValid: true
      },
      forceGreatCircleArcs: {
        path: "useActualRoute",
        urlValid: true,
        mapFunc: function(useArcsParamString) {
          var forceArcs = mapBool(useArcsParamString);
          if (forceArcs === undefined) {
            forceArcs = false;
          }
          return !forceArcs;
        },
        defaultValue: true
      },

      tourSymbol: { 
        path: "symbols.tour",
        urlValid: false
      },
      stopSymbol: { 
        path: "symbols.stops",
        urlValid: false
      },
      labelSymbol: {
        path: "symbols.labels",
        urlValid: false
      },
      labelPositions: { 
        path: "labelPositions",
        urlValid: false
      }
    };
  }

  function readConfig(config) {
    // These are parameters that can be set. Those with urlValid can also be set via the Query String.
    // If allowURLParameter == false, no parameters can be passed via the URL.
    // Identical parameters passed via the constructor and via the URL are read from the constructor.
    var validParams = getUrlParameterMappingForValidParams();

    // Have we disallowed URL parameters?
    var allowURLParameters = (typeof config.allowURLParameters === "boolean") ? config.allowURLParameters : true;

    // Get a list of parameters that can be read from the URL.
    var validURLParams = !allowURLParameters ? [] : Object.getOwnPropertyNames(validParams).filter(function (paramName) {
      return validParams[paramName].urlValid;
    });

    // If a whitelist was provided, narrow the list down according to that whitelist.
    if (Array.isArray(config.allowURLParameters)) {
      validURLParams = validURLParams.filter(function (paramName) {
        return config.allowURLParameters.indexOf(paramName) > -1;
      });
    }

    // Now read the parameters, from the URL if allowed or else the constructor if possible.
    var paramNames = Object.getOwnPropertyNames(validParams);
    for (var i=0; i < paramNames.length; i++) {
      var paramName = paramNames[i],
          paramInfo = validParams[paramName],
          paramFromURL = (validURLParams.indexOf(paramName) > -1) ? getParameterByName(paramName) : undefined,
          paramVal = (paramFromURL !== undefined) ? paramFromURL : config[paramName];

      if (paramVal !== undefined) {
        // If a mapFunc is specified for the parameter, use that to transform the read parameter.
        if (typeof paramInfo.mapFunc === "function") {
          paramInfo.value = paramInfo.mapFunc(paramVal);
        } else {
          paramInfo.value = paramVal;
        }
      } else {
        if (paramInfo.hasOwnProperty("defaultValue")) {
          paramInfo.value = paramInfo.defaultValue;
        } else {
          // If no valid value was read, discard the parameter.
          delete validParams[paramName];
        }
      }
    }

    // Get a baseline deep configuration object.
    var mergedConfig = getDefaultConfig();

    // Handle the special case of "routeResultServiceURL" which invalidates some other parameters.
    if (validParams.routeResultServiceURL) {
      // Derive some URLs
      validParams.stopLayerURL = {
        path: "data.stopLayerURL", 
        value: validParams.routeResultServiceURL.value + "/" + mergedConfig.data.stopLayerID
      };
      if (!(validParams.hasOwnProperty("forceGreatCircleArcs") && validParams.forceGreatCircleArcs.value === false)) {
        validParams.trackServiceURL = {
          path: "data.trackServiceURL", 
          value: validParams.routeResultServiceURL.value + "/" + mergedConfig.data.trackLayerID
        };
      }
      // Ignore some other parameters
      delete validParams.stopNameField;
      delete validParams.stopSequenceField;
    } else {
      if (validParams.forceGreatCircleArcs && validParams.forceGreatCircleArcs.vallue == false) {
        validParams.forceGreatCircleArcs.value = true;
      }
    }

    // Now merge the parameters we have left, wherever we read them from, into the default
    // configuration object.
    paramNames = Object.getOwnPropertyNames(validParams);
    for (var i=0; i < paramNames.length; i++) {
      var paramName = paramNames[i],
          paramInfo = validParams[paramName],
          paramValue = paramInfo.value,
          targetKey = paramInfo.path.split("."),
          targetObject = mergedConfig;

      while (targetKey.length > 1) {
        targetObject = targetObject[targetKey.shift()];
      }

      targetObject[targetKey[0]] = paramValue;
    }

    // If we don't have enough configuration info for a Tour, add the demo parameters.
    fallbackToDemoConfigIfAppropriate(mergedConfig);

    return mergedConfig;
  }

  function fallbackToDemoConfigIfAppropriate(config) {
    if (!config.data.stopLayerURL) {
      config.data.stopLayerURL = demoRouteServiceURL + "/" + config.data.stopLayerID;
      if (config.useActualRoute !== false) {
        config.useActualRoute = true;
        config.data.trackServiceURL = demoRouteServiceURL + "/" + config.data.trackLayerID;
      } else {
        config.data.trackServiceURL = null;
      }
      config.labelPositions = {
        offsetBelow: [3,4,9,13,17,19,20,23,25,30,42],
        leftAlign: [1,5,6,11,15,22,23,24,27,33,38,42,44],
        rightAlign: [8,16,17,18,19,21,28,30,34,35,36,37,39,40,43]
      }
    }
  }

  /// SAFELY PARSE URL STRING PARAMETERS
  function mapBool(strBool) {
    if (typeof strBool === "string") {
      return strBool == "true" ? true : (strBool == "false" ? false : undefined);
    } else if (typeof strBool === "boolean") {
      return strBool;
    }
    return undefined;
  }

  function mapInt(strInt) {
    var parsed = parseInt(strInt);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
    return undefined;
  }

  function mapFloat(strFloat) {
    var parsed = parseFloat(strFloat);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
    return undefined;
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
