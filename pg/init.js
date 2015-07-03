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
/*global plv8, debug, require, NOTICE, ERROR*/
(function () {

  // ..........................................................
  // LOCAL
  //

  var module, script,
    modules = plv8.execute("SELECT * FROM \"$module\""),
    n = 0;

  // ..........................................................
  // GLOBAL
  //

  /**
    Helper debug function. Raises a plv8 notice passing the value argument.
    @returns {String} Value
  */
  debug = function (value) {
    value = typeof value === "object" ? JSON.stringify(value, null, 2) : value;
    plv8.elog(NOTICE, value);
  };

  /**
    Load a module into memory.

    @param {String} Module name
    @returns {Object} Exports
  */
  require = function (name) {
    var found = modules.filter(function (row) {
        return row.name === name;
      }),
      exports = {};

    if (!found.length) {
      plv8.elog(ERROR, "Module " + name + " not found.");
    }

    eval(found[0].script);

    return exports;
  };

  /**
    * Escape strings to prevent sql injection
      http://www.postgresql.org/docs/9.1/interactive/functions-string.html
    *
    * @param {String} A string with tokens to replace.
    * @param {Array} Array of replacement strings.
    * @return {String} Escaped string.
  */
  String.prototype.format = function (ary) {
    var params = [],
      i = 0,
      sql;

    ary = ary || [];
    ary.unshift(this);

    while (ary[i]) {
      i++;
      params.push("$" + i);
    }

    sql = "select format(" + params.toString(",") + ")";

    return plv8.execute(sql, ary)[0].format;
  };

  /**
     Change string with underscores '_' to camel case.
     @param {Boolean} Convert first character to upper case. Default false.
     @returns {String}
  */
  String.prototype.toCamelCase = function (upper) {
    var str = this.replace(/-+(.)?/g, function (match, chr) {
      return chr ? chr.toUpperCase() : '';
    });

    return upper ? str.slice(0, 1).toUpperCase() + str.slice(1) : str;
  };

  /**
     Change a camel case string to snake case.
     @returns {String} The argument modified
  */
  String.prototype.toSnakeCase = function () {
    return this.replace((/([a-z])([A-Z])/g), '$1_$2').toLowerCase();
  };

  // Load global modules
  while (n < modules.length) {
    module = modules[n];

    if (module.is_global) {
      script = module.name + "= require(\"" + module.name + "\");";
      eval(script);
    }

    n++;
  }
}());

