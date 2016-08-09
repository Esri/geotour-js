require([
  "esri/views/ui/UI"
], function(UI) {
  /// View UI Helper Functions.
  var extension = {
    hide: function() {
      _setUIVisible(this, false);
    },
    show: function() {
      _setUIVisible(this, true);
    }
  };

  safeExtend(UI, extension);

  function _setUIVisible(ui, visible) {
    var items = ui._components; // Sneaky

    for (var i=0; i<items.length; i++) {
      var component = ui.find(items[i]);
      setComponentVisible(component, visible);
    }

    function setComponentVisible(component, visible) {
      var widget = component.widget;
      if (widget) {
        widget.visible = visible;
      } else {
        component.node.style.display = visible ? "" : "none";
      }
    }
  }

  function safeExtend(classToExtend, extension) {
    var existing = Object.getOwnPropertyNames(extension).filter(function (item) {
      return UI.prototype[item] !== undefined;
    });

    for (var i=0; i < existing.length; i++) {
      console.warn("'" + existing[i] + "' already exists on class " + classToExtend.prototype.declaredClass + ": Skipping…");
      delete extension[existing[i]];
    }

    classToExtend.extend(extension);

    return existing;
  }
});
