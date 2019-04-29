/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
import catalog from "./catalog.js";
import model from "./model.js";

function formAttr(data, feather) {
    let that;

    function handleProp(name, validator) {
        let attr = that.data.attr;
        let formFeather = that.parent().data.feather();
        let prop = that.data[name];
        let fprop;
        let readOnly;

        if (!formFeather || !attr()) {
            prop.isReadOnly(true);
            return;
        }

        formFeather = catalog.getFeather(formFeather);
        fprop = formFeather.properties[attr()];

        readOnly = validator(fprop);
        prop.isReadOnly(readOnly);

        return readOnly;
    }

    function handleColumns() {
        let columns = that.data.columns();

        function validator(fprop) {
            return Boolean(
                !fprop || typeof fprop.type !== "object" ||
                !fprop.type.parentOf
            );
        }

        if (handleProp("columns", validator)) {
            columns.canAdd(false);
        } else {
            columns.canAdd(true);
        }
    }

    function handleDataList() {
        function validator(fprop) {
            return Boolean(
                !fprop || typeof fprop.type === "object" ||
                fprop.type === "boolean"
            );
        }

        handleProp("dataList", validator);
    }

    function handleDisableCurrency() {
        function validator(fprop) {
            return Boolean(
                !fprop || fprop.type !== "object" ||
                fprop.format !== "money"
            );
        }

        handleProp("disableCurrency", validator);
    }

    function handleRelationWidget() {
        function validator(fprop) {
            return Boolean(
                !fprop || typeof fprop.type !== "object" ||
                fprop.type.parentOf
            );
        }

        handleProp("relationWidget", validator);
    }

    function properties() {
        let keys;
        let formFeather = that.parent().data.feather();
        let result = [];

        if (!formFeather) {
            return result;
        }
        formFeather = catalog.getFeather(formFeather);
        keys = Object.keys(formFeather.properties || []).sort();
        return keys.map(function (key) {
            return {
                value: key,
                label: key
            };
        });
    }

    feather = feather || catalog.getFeather("FormAttr");
    that = model(data, feather);

    that.addCalculated({
        name: "properties",
        type: "array",
        function: properties
    });

    that.onChanged("attr", handleColumns);
    that.onChanged("attr", handleDataList);
    that.onChanged("attr", handleDisableCurrency);
    that.onChanged("attr", handleRelationWidget);
    that.onLoad(handleColumns);
    that.onLoad(handleDataList);
    that.onLoad(handleDisableCurrency);
    that.onLoad(handleRelationWidget);

    that.data.columns().canAdd(false);

    that.onValidate(function () {
        let found = that.parent().data.properties().find(
            (p) => that.data.attr() === p.value
        );

        if (!found) {
            throw (
                "Attribute '" + that.data.attr() + "' not in feather '" +
                that.parent().data.feather() + "'"
            );
        }
    });

    return that;
}

catalog.registerModel("FormAttr", formAttr);
