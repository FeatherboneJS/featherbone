/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

(function (exports) {
  "strict";
  var conn,
    pg = require("pg"),
    controller = require("./controller"),
    readPgConfig = require("./pgconfig"),
    registered = {
      GET: {},
      POST: {},
      PUT: {},
      PATCH: {},
      DELETE: {}
    },
    that = {},
    settings = controller.settings();

  const TRIGGER_BEFORE = 1,
    TRIGGER_AFTER = 2;


  // ..........................................................
  // PRIVATE
  //

  function isRegistered (method, name, trigger) {
    var fn = registered[method][name],
      ret = typeof fn === "function";

    if (ret && trigger) {
      if ((trigger === TRIGGER_BEFORE &&
        fn.trigger !== TRIGGER_BEFORE) ||
        (trigger === TRIGGER_AFTER &&
        fn.trigger !== TRIGGER_AFTER)) {
        ret = false;
      }
    }

    return ret;
  }

  // ..........................................................
  // PUBLIC
  //

  that.TRIGGER_BEFORE = TRIGGER_BEFORE;
  that.TRIGGER_AFTER = TRIGGER_AFTER;

  /**
    Fetch catalog.

    @returns {Object} promise
  */
  that.getCatalog = function () {
    return new Promise (function (resolve, reject) {
      var payload = {
          method: "GET",
          name: "getSettings",
          user: that.getCurrentUser(),
          data: {
            name: "catalog"
          }
        };

      that.request(payload).then(resolve).catch(reject);
    });
  };

  /**
    Fetch controllers.

    @returns {Object} promise
  */
  that.getControllers = function () {
    return new Promise (function (resolve, reject) {
      var payload = {
          method: "GET",
          name: "getControllers",
          user: that.getCurrentUser()
        };

      that.request(payload).then(resolve).catch(reject);
    });
  };

  that.getCurrentUser = function () {
    // TODO: Make this real
    return "postgres";
  };

  /**
    Fetch routes.

    @returns {Object} promise
  */
  that.getRoutes = function () {
    return new Promise (function (resolve, reject) {
      var payload = {
          method: "GET",
          name: "getRoutes",
          user: that.getCurrentUser()
        };

      that.request(payload).then(resolve).catch(reject);
    });
  };

  /**
    Request.

    Example payload:
        {
           "name": "Contact",
           "method": "POST",
           "data": {
             "id": "1f8c8akkptfe",
             "created": "2015-04-26T12:57:57.896Z",
             "createdBy": "admin",
             "updated": "2015-04-26T12:57:57.896Z",
             "updatedBy": "admin",
             "fullName": "John Doe",
             "birthDate": "1970-01-01T00:00:00.000Z",
             "isMarried": true,
             "dependentes": 2
           }
        }

    @param {Object} Payload
    @param {String} [payload.name] Name of feather or function
    @param {String} [payload.method] Method to perform: "GET", "POST",
      "PUT", "PATCH" or "DELETE"
    @param {String} [payload.id] Identifier for "GET", "PATCH" ond "DELETE"
    @param {String} [payload.data] Data for "POST" and "PATCH" or functions
    @param {Object} [payload.client] Database client. If undefined one will
      be intialized by default and wrapped in a transaction if necessary.
    @param {String} [payload.callback] Callback  
    @param {Boolean} Bypass authorization checks. Default = false.
    @param {Boolean} Ignore registration and treat as data. Default = false.
    @return receiver
  */
  that.request = function (obj, isSuperUser) {
    return new Promise (function (resolve, reject) {
      isSuperUser = isSuperUser === undefined ? false : isSuperUser;

      var client, done, transaction, isChild,
        catalog = settings.catalog ? settings.catalog.data : {},
        isExternalClient = false,
        wrap = false,
        isTriggering = obj.client ? obj.client.isTriggering : false;

      function close (resp) {
        return new Promise (function (resolve) {
          //console.log("CLOSING");
          done(); 
          resolve(resp);
        });
      }

      function error (err) {
        //console.log("ERROR->", obj.name, obj.method);
        var statusCode;

        // Passed client will handle it's own connection
        if (!isExternalClient) { done(); }

        // Format errors into objects that can be handled by server
        console.error(err);
        if (typeof err === "object" && !(err instanceof Error)) {
          statusCode = err.statusCode;
          err = new Error(err.message);
        } else {
          err = new Error(err);
        }

        err.statusCode = statusCode || 500;
        return err;
      }

      function commit (resp) {
        return new Promise (function (resolve, reject) {
          // Forget about committing if recursive
          if (isTriggering || isExternalClient) {
            resolve(resp);
            return;
          }

          if (client.wrapped) {
            //console.log("COMMIT->", obj.name, obj.method);
            client.query("COMMIT;", function (err) {
              client.wrapped = false;
              if (err) {
                reject(error(err));
                return;
              }

              //console.log("COMMITED");
              resolve(resp);
            });
            return;
          }

          resolve(resp);
        });
      }

      function rollback (err) {
        // If external, let caller deal with transaction
        if (isExternalClient) { 
          reject(err);
          return;
        }

        //console.log("ROLLBACK->", obj.name, obj.method);

        if (client.wrapped) {
          client.query("ROLLBACK;", function () {
            //console.log("ROLLED BACK");
            client.wrapped = false;
            reject(error(err));
          });
          return;
        }
    
        reject(error(err));
      }

      function doExecute () {
        // console.log("EXECUTE->", obj.name, obj.method, transaction.name);
        return new Promise (function (resolve, reject) {
          if (wrap && !client.wrapped && !isTriggering) {
            client.query("BEGIN;", function (err) {
              if (err) {
                reject(err);
                return;
              }
              //console.log("BEGAN");

              client.wrapped = true;
              transaction(obj, false, isSuperUser)
                .then(resolve)
                .catch(reject);
            });
            return;
          }

          // Passed client must handle its own transaction wrapping
          transaction(obj, isChild, isSuperUser)
            .then(resolve)
            .catch(reject);
        });
      }

      function doMethod (name) {
        // console.log("METHOD->", obj.name, obj.method, name);
        return new Promise (function (resolve, reject) {
          wrap = !obj.client && obj.method !== "GET";
          obj.data = obj.data || {};
          obj.data.id = obj.data.id || obj.id;
          obj.client = client;
          transaction = registered[obj.method][name];
          Promise.resolve()
            .then(doExecute)
            .then(resolve)
            .catch(reject);
        });
      }

      function clearTriggerStatus () {
        // console.log("CLEAR_TRIGGER->", obj.name, obj.method);
        return new Promise (function (resolve) {
          if (!isTriggering) {
            client.isTriggering = false;
          }

          resolve();
        });
      }

      function doTraverseAfter (name) {
        // console.log("TRAVERSE_AFTER->", obj.name, obj.method, name);
        return new Promise (function (resolve, reject) {
          var feather = settings.catalog.data[name],
            parent = feather.inherits || "Object";

          // If business logic defined, do it
          if (isRegistered(obj.method, name, TRIGGER_AFTER)) {
            client.isTriggering = true;

            if (name === "Object") {
              Promise.resolve()
                .then(doMethod.bind(null, name))
                .then(clearTriggerStatus)
                .then(commit)
                .then(resolve)
                .catch(rollback);
              return;
            }

            Promise.resolve()
              .then(doMethod.bind(null, name))
              .then(clearTriggerStatus)
              .then(doTraverseAfter.bind(null, parent))
              .then(resolve)
              .catch(rollback);

          // If traversal done, finish transaction
          } else if (name === "Object") {
            commit(obj.response).then(resolve).catch(reject);

          // If no logic, but parent, traverse up the tree
          } else {
            doTraverseAfter(parent).then(resolve).catch(reject);
          }
        });
      }

      function doQuery () {
        // console.log("QUERY->", obj.name, obj.method);
        return new Promise (function (resolve, reject) {
          obj.client = client;
          isChild = false;

          switch (obj.method) {
          case "GET":
            controller.doSelect(obj, false, isSuperUser)
              .then(resolve)
              .then(reject);
            return;
          case "POST":
            if (obj.id) {
              transaction = controller.doUpsert;
            } else {
              transaction = controller.doInsert;
            }
            break;
          case "PATCH":
            transaction = controller.doUpdate;
            break;
          case "DELETE":
            transaction = controller.doDelete;
            break;
          default:
            reject(error("method \"" + obj.method + "\" unknown"));
            return;
          }

          doExecute()   
            .then(function (resp) {
              obj.response = resp;
              doTraverseAfter(obj.name)
                .then(resolve)
                .catch(error);
            })
            .catch(error);
        });
      }

      function doTraverseBefore (name) {
        // console.log("TRAVERSE_BEFORE->", obj.name, obj.method, name);
        return new Promise (function (resolve, reject) {
          var feather = settings.catalog.data[name],
            parent = feather.inherits || "Object";

          // If business logic defined, do it
          if (isRegistered(obj.method, name, TRIGGER_BEFORE)) {
            client.isTriggering = true;
            if (name === "Object") {
              Promise.resolve()
                .then(doMethod.bind(null, name))
                .then(clearTriggerStatus)
                .then(doQuery)
                .then(resolve)
                .catch(reject);
              return;
            }

            Promise.resolve()
              .then(doMethod.bind(null, name))
              .then(clearTriggerStatus)
              .then(doTraverseBefore.bind(null, parent))
              .then(resolve)
              .catch(rollback);

          // Traversal done
          } else if (name === "Object") {
            doQuery().then(resolve).catch(reject);

          // If no logic, but parent, traverse up the tree
          } else {
            doTraverseBefore(parent).then(resolve).catch(reject);
          }
        });
      }

      function doRequest () {
        //console.log("REQUEST->", obj.name, obj.method);
        return new Promise (function (resolve, reject) {
          if (!client.currentUser && !obj.user) {
            reject("User undefined." + obj.method + obj.name);
            return;
          }

          if (!client.currentUser) {
            client.currentUser = obj.user;
          }

          // If alter data, process it
          if (catalog[obj.name]) {
            if (obj.method === "GET") {
              doQuery().then(resolve).catch(reject);
            } else {
              if (!isExternalClient) { 
                wrap = true;
              }

              doTraverseBefore(obj.name)
                .then(resolve)
                .catch(reject);
            }

          // If function, execute it
          } else if (isRegistered(obj.method, obj.name)) {
            Promise.resolve()
              .then(doMethod.bind(null, obj.name))
              .then(commit)
              .then(resolve)
              .catch(rollback);

          // Young fool, now you will die.
          } else {
            reject("Function " + obj.method + " " + obj.name + " is not registered.");
          }
        });
      }

      function connect () {
        // console.log("CONNECT->", obj.name, obj.method);
        return new Promise (function (resolve, reject) {
          pg.connect(conn, function (err, c, d) {
            client = c;
            done = d;

            // handle an error from the connection
            if (err) {
              controller.setCurrentUser(undefined);
              console.error("Could not connect to server", err);
              reject(err);
              return;
            }

            resolve();
          });
        });
      }

      if (obj.client) {
        isExternalClient = true;
        client = obj.client;
        Promise.resolve()
          .then(doRequest)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (conn) {
        Promise.resolve()
          .then(connect)
          .then(doRequest)
          .then(close)
          .then(resolve)
          .catch(reject);
        return;
      }

      // Read configuration if necessary
      function setCredentials (config) {
        // console.log("SET_CREDS->", obj.name, obj.method);
        return new Promise (function (resolve) {
          conn = "postgres://" +
            config.user + ":" +
            config.password + "@" +
            config.server + "/" +
            config.database;
          resolve();
        });
      }

      Promise.resolve()
        .then(readPgConfig)
        .then(setCredentials)
        .then(connect)
        .then(doRequest)
        .then(close)
        .then(resolve)
        .catch(reject);
    });
  };

  /**
    Register a function that can be called by a method type. Use
    this to expose function calls via `request`. As a rule, all
    functions must accept an object as an argument whose properties
    can be used to calculate the result. The object should be passed
    as `data` on the request.

    The object should include a callback to forward a response on
    completion. The callback should accept an error as the first
    argument and a response as the second.

    The request will automatically append an active client to the object
    to use for executing queries.

      var fn, callback, datasource = require(./datasource);

      // Create a function that updates something specific
      fn = function (obj) {
        var sql = "UPDATE foo SET bar = false WHERE id=$1;",
          params = [obj.id];

        obj.client.query(sql, params, function (err, resp) {
          obj.callback(err, resp.rows);
        })
      }

      // Register the function
      datasource.registerFunction("POST", "myUpdate", fn);

      // Define a callback to use when calling our function
      callback = function (err, resp) {
        if (err) {
          console.error(err);
          return;
        }

        console.log("Query rows->", resp);
      }

      // Execute a request that calls our function and sends a response
      // via the callback
      datasource.request({
        method: "GET",
        name: "myUpdate",
        callback: callback,
        data: {
          id: "HTJ28n"
        }
      });

    @seealso requestFunction
    @param {String} Function name
    @param {String} Method. "GET", "POST", "PUT", "PATCH", or "DELETE"
    @param {Function} Function
    @param {Number} Constant TRIGGER_BEFORE or TRIGGER_AFTER
    @return receiver
  */
  that.registerFunction = function (method, name, func, trigger) {
    registered[method][name] = func;
    if (trigger) { 
      func.trigger = trigger;
    }
    return that;
  };

  /**
    @return {Object} Object listing register functions
  */
  that.registeredFunctions = function () {
    var keys = Object.keys(registered),
      result = {};

    keys.forEach(function (key) {
      result[key] = Object.keys(registered[key]);
    });

    return result;
  };

  /**
    @return {Object} Internal settings object maintained by controller
  */
  that.settings = function () {
    return settings;
  };

  /**
    Helper to expose a registered function to the public API. Use by binding
    the name of the registered function to be called. The function will transform
    the data on a routed requset to the proper format to make a `POST` request
    on the registered function.

      // Expose the example function described on `registerFunction` to a router.
      (function (app, datasource) {
        "strict";

        // Register route to the public
        var express = require("express");
          router = express.Router(),
          func = datasource.postFunction.bind("myUpdate");

        router.route("/my-update").post(func);
        app.use('/my-app', router);

      }(app, datasource));

    @param {Object} Request
    @param {Object} Response
    @seealso registerFunction
    @return receiver
  */
  that.postFunction = function (req, res) {
   var payload,
      args = req.body;

	function error (err) {
      this.status(err.statusCode).json(err.message);
	}

    function callback (resp) {
      if (resp === undefined) {
        res.statusCode = 204;
      }

      // No caching... ever
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate"); // HTTP 1.1.
      res.setHeader("Pragma", "no-cache"); // HTTP 1.0.
      res.setHeader("Expires", "0"); //
      res.json(resp);
    }

    payload = {
      method: "POST",
      name: this,
      user: "postgres", //getCurrentUser(),
      data: args
    };

    console.log(JSON.stringify(payload, null, 2));
    that.request(payload)
      .then(callback)
      .catch(error);
  };

  // Set properties on exports
  Object.keys(that).forEach(function (key) {
    exports[key] = that[key];
  });

  // Transformation helper for crud functions
  var proxy = function (obj) {
    obj.data.client = obj.client;
    obj.data.callback = obj.callback;
    controller[this](obj.data);
  };

  // Register certain functions
  that.registerFunction("GET", "getControllers", controller.getControllers);
  that.registerFunction("GET", "getFeather", controller.getFeather);
  that.registerFunction("GET", "getModules", controller.getModules);
  that.registerFunction("GET", "getRoutes", controller.getRoutes);
  that.registerFunction("GET", "getSettings", controller.getSettings);
  that.registerFunction("GET", "getSettingsRow", controller.getSettingsRow);
  that.registerFunction("GET", "getSettingsDefinition", 
    controller.getSettingsDefinition);
  that.registerFunction("GET", "getWorkbook", controller.getWorkbook);
  that.registerFunction("GET", "getWorkbooks", controller.getWorkbooks);
  that.registerFunction("GET", "isAuthorized", controller.isAuthorized);
  that.registerFunction("POST", "doDelete", proxy.bind("doDelete"));
  that.registerFunction("POST", "doInsert", proxy.bind("doInsert"));
  that.registerFunction("POST", "doUpdate", proxy.bind("doUpdate"));
  that.registerFunction("POST", "doUpsert", proxy.bind("doUpsert"));
  that.registerFunction("PUT", "saveAuthorization",
    controller.saveAuthorization);
  that.registerFunction("PUT", "saveFeather", controller.saveFeather);
  that.registerFunction("PUT", "saveSettings", controller.saveSettings);
  that.registerFunction("PUT", "saveWorkbook", controller.saveWorkbook);
  that.registerFunction("DELETE", "deleteFeather", controller.deleteFeather);
  that.registerFunction("DELETE", "deleteWorkbook", controller.deleteWorkbook);

}(exports));