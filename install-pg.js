/**
    Featherbone is a JavaScript based persistence framework for building object
    relational database applications
    
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

var manifest, file, content, result, execute, name, createFunction, buildApi,
  saveModule, saveModels, rollback, connect, commit, begin, processFile, ext,
  client, user, processProperties,
  pg = require("pg"),
  fs = require("fs"),
  path = require("path"),
  yaml = require("js-yaml"),
  pgConfig = require("./common/pgconfig.js"),
  filename = path.format({root: "/", base: "manifest.json"}),
  i = 0;

connect = function (callback) {
  pgConfig(function (config) {
    var conn = "postgres://" +
      config.user + ":" +
      config.password + "@" +
      config.server + "/" +
      config.database;

    user = config.user;
    client = new pg.Client(conn);

    client.connect(function (err) {
      if (err) {
        console.error(err);
        return;
      }

      callback();
    });
  });
};

begin = function () {
  client.query("BEGIN;", processFile);
};

commit = function (callback) {
  client.query("COMMIT;", function () {
    console.log("Install completed!");
    client.end();
    callback();
  });
};

rollback = function () {
  client.query("ROLLBACK;", function () {
    console.log("Install failed.");
    client.end();
  });
};

execute = function (script) {
  var sql = "DO $$" + script + "$$ LANGUAGE plv8;";

  client.query(sql, processFile);
};

createFunction = function (name, args, returns, volatility, script) {
  volatility = volatility || "VOLATILE";

  var keys, arg, txt,
    sql = "CREATE OR REPLACE function " + name + "(",
    ary = [],
    n = 0;

  if (args) {
    keys = Object.keys(args);

    while (n < keys.length) {
      arg = args[keys[n]];
      txt = keys[n] + " " + arg.type;

      if (arg.defaultValue) {
        txt += " default " + arg.defaultValue;
      }

      ary.push(txt);
      n++;
    }

    sql += ary.join(", ");
  }

  sql += ") RETURNS " + (returns || "void") + " AS $$" + script +
    "$$ LANGUAGE plv8 " + volatility + ";";

  client.query(sql, processFile);
};

processFile = function (err) {
  if (err) {
    console.error(err);
    rollback();
    return;
  }

  file = manifest.files[i];
  i++;

  // If we've processed all the files, wrap this up
  if (!file) {
    commit(buildApi);
    return;
  }

  filename = file.path;
  ext = path.extname(filename);
  name = path.parse(filename).name;

  fs.readFile(filename, "utf8", function (err, data) {
    if (err) {
      console.error(err);
      return;
    }

    content = data;

    console.log("Installing " + filename);

    switch (file.type) {
    case "execute":
      execute(content);
      break;
    case "function":
      createFunction(name, file.args, file.returns, file.volatility, content);
      break;
    case "module":
      saveModule(file.name || name, content, file.isGlobal, manifest.version);
      break;
    case "model":
      saveModels(JSON.parse(content));
      break;
    default:
      console.error("Unknown type.");
      rollback();
      return;
    }
  });
};

saveModule = function (name, script, isGlobal, version) {
  isGlobal = JSON.stringify(isGlobal || false);

  var sql = "SELECT * FROM \"$module\" WHERE name='" + name + "';";

  client.query(sql, function (err, result) {
    if (err) {
      rollback();
      console.error(err);
      return;
    }
    if (result.rows.length) {
      sql = "UPDATE \"$module\" SET " +
        "script=$$" + script + "$$," +
        "is_global='" + isGlobal + "', " +
        "version='" + version + "' " +
        "WHERE name='" + name + "';";
    } else {
      sql = "INSERT INTO \"$module\" VALUES ('" + name +
        "',$$" + script + "$$," + isGlobal + ", '" + version + "');";
    }

    client.query(sql, processFile);
  });
};

saveModels = function (models) {
  var payload = JSON.stringify({
      method: "POST",
      name: "saveModel",
      user: user,
      data: [models]
    }),
    sql = "SELECT request($$" + payload + "$$);";

  client.query(sql, function (err) {
    if (err) {
      console.error(err);
      rollback();
      return;
    }

    processFile();
  });
};

buildApi = function () {
  var swagger, catalog, sql, payload, keys;

  // Load the baseline swagger file
  fs.readFile("config/swagger-base.yaml", "utf8", function (err, data) {
    if (err) {
      console.error(err);
      return;
    }

    swagger = yaml.safeLoad(data);

    // Load the existing model catalog from postgres
    connect(function (err) {
      if (err) {
        console.error(err);
        return;
      }

      payload = {
        method: "POST",
        name: "getSettings",
        user: "postgres",
        data: "catalog"
      };
      sql = "SELECT request($$" + JSON.stringify(payload) + "$$) as response;";

      // ...execute query
      client.query(sql, function (err, resp) {
        var definitions = swagger.definitions;

        if (err) {
          console.error(err);
          return;
        }

        catalog = resp.rows[0].response.value;

        // Loop through each model and append to swagger api
        keys = Object.keys(catalog);
        keys.forEach(function (key) {
          var model = catalog[key],
            properties = {},
            inherits = model.inherits || "Object",
            definition;

          // Append model definition
          definition = {
            description: model.description,
            discriminator: model.discriminator
          };

          processProperties(model, properties);

          if (key === "Object") {
            definition.properties = properties;
          } else {
            definition.allOf = [
              {$ref: "#/definitions/" + inherits},
              {properties: properties}
            ];
          }

          if (model.required) {
            definition.required = model.required;
          }

          definitions[key] = definition;
        });

        console.log(JSON.stringify(swagger, null, 2));
        client.end();
      });
    });
  });
};

processProperties = function (model, properties) {
  console.log("model->", model);
  var keys = Object.keys(model.properties);

  keys.forEach(function (key) {
    var property = model.properties[key],
      primitives = ["array", "boolean", "integer", "number", "null",
        "object", "string"],
      formats = ["integer", "long", "float", "double", "string", "double",
        "string", "byte", "boolean", "date", "dateTime", "password"],
      newProperty;

    newProperty = {
      description: property.description,
      default: property.defaultValue
    };

    if (typeof property.type === "object") {
      newProperty.type = "object";
      newProperty.items = {
        $ref: "#/definitions/" + property.type.relation
      };
    } else {
      if (primitives.indexOf(property.type) !== -1) {
        newProperty.type = property.type;
      } else if (formats.indexOf(property.type) === -1) {
        console.error("Unsupported type \"" + property.type + "\"");
      } else {
        switch (property.type) {
        case "date":
        case "dateTime":
        case "byte":
        case "password":
          newProperty.type = "string";
          break;
        case "long":
          newProperty.type = "integer";
          break;
        case "float":
        case "double":
          newProperty.type = "number";
          break;
        default:
          newProperty.type = property.type;
        }

        newProperty.format = property.type;
      }
    }

    properties[key] = newProperty;
  });
};

/* Real work starts here */
fs.readFile(filename, "utf8", function (err, data) {
  if (err) {
    console.error(err);
    return;
  }

  manifest = JSON.parse(data);
  connect(begin);
});


