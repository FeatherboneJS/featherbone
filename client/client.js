/**
    Framework for building object relational database apps

    Copyright (C) 2015  John Rogelstad
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

/*global m, f, window */

(function () {

  "strict";

  var workbooks = m.prop(),
    getConfig = function (workbook) {
      var config = workbook.defaultConfig;
      if (Object.keys(workbook.localConfig).length) {
        config = workbook.localConfig;
      }
      return config;
    };

  // Load catalog and process models
  f.init(function () {
    return f.catalog.fetch().then(function (data) {
      var feathers;

      feathers = Object.keys(data());
      feathers.forEach(function (feather) {
        var name = feather.toCamelCase(),
          plural = f.catalog.getFeather(feather, false).plural;

        // Implement generic function to object from model
        if (typeof f.models[name] !== "function") {
          // Model instance
          f.models[name] = function (data, model) {
            var shared = model || f.catalog.getFeather(feather),
              obj = f.model(data, shared);

            return obj;
          };

          // List instance
          if (plural) {
            f.models[name].list = f.list(feather);
          }
        }
      });

      return true;
    });
  });

  // Load modules
  f.init(function () {
    var ds = f.dataSource,
      modules = m.prop([]),
      payload = {method: "GET", path: "/modules/"};

    return ds.request(payload).then(modules).then(function () {
      // Loop through each module record and run script
      modules().forEach(function (module) {
        eval(module.script);
      });

      return true;
    });
  });

  // Load workbooks
  f.init(function () {
    var ds = f.dataSource,
      payload = {method: "GET", path: "/workbooks/"};

    return ds.request(payload).then(workbooks);
  });

  // When all intialization done, construct app.
  f.init().then(function () {
    var app = {},
      routes = {};

    // Build home navigation page
    app.Home = {
      controller: function () {
        var that = this;

        workbooks().forEach(function (workbook) {
          var config = getConfig(workbook),
            sheet = Object.keys(config)[0],
            feather = config[sheet].feather,
            name = workbook.name + sheet,
            plural = f.catalog.data()[feather].plural,
            route = "/" + workbook.name + "/" + plural;
          route = route.toSpinalCase();

          that["go" + name] = function () {
            m.route(route);
          };
        });
      },
      view: function (ctrl) {
        var buttons = workbooks().map(function (workbook) {
            var config = getConfig(workbook),
              sheet = Object.keys(config)[0],
              name = workbook.name + sheet;
            return m("button[type=button]", {
              class: "pure-button",
              onclick: ctrl["go" + name]
            }, workbook.name);
          });
        return m("div", buttons);
      }
    };
    routes["/home"] = app.Home;

    // Build app for each configured object
    workbooks().forEach(function (workbook) {
      var config = getConfig(workbook),
        keys = Object.keys(config);

      keys.forEach(function (sheet) {
        var name = workbook.name + sheet,
          feather = config[sheet].feather,
          plural = f.catalog.data()[feather].plural,
          wbkroute = "/" + workbook.name + "/" + plural,
          frmroute = "/" + workbook.name + "/" + feather;
        name = name.toCamelCase();
        wbkroute = wbkroute.toSpinalCase();
        frmroute = frmroute.toSpinalCase();

        // Build UI
        app[name + "WorkbookDisplay"] = f.components.workbookDisplay({
          name: workbook.name,
          feather: feather,
          attrs: config[sheet].list.attrs,
          config: config,
          selectedTab: sheet
        });

        app[name + "FormDisplay"] = f.components.formDisplay({
          feather: feather,
          attrs: config[sheet].form.attrs
        });

        // Build routes
        routes[wbkroute] = app[name + "WorkbookDisplay"];
        routes[frmroute] = app[name + "FormDisplay"];
        routes[frmroute + "/:id"] = app[name + "FormDisplay"];
      });
    });

    m.route(document.body, "/home", routes);
  });

  window.onresize = function () {
    m.redraw(true);
  };

}());

