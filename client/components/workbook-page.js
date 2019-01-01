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
/*jslint this, browser*/
import {f} from "../core.js";
import {stream} from "../../common/stream-client.js";
import {button} from "./button.js";
import {catalog} from "../models/catalog.js";
import {dialog} from "./dialog.js";
import {filterDialog} from "./filter-dialog.js";
import {sortDialog} from "./sort-dialog.js";
import {sheetConfigureDialog} from "./sheet-configure-dialog.js";
import {searchInput} from "./search-input.js";
import {tableWidget} from "./table-widget.js";
import {navigator} from "./navigator-menu.js";

const workbookPage = {};
const m = window.m;

// Define workbook view model
workbookPage.viewModel = function (options) {
    let listState;
    let tableState;
    let searchState;
    let currentSheet;
    let feather;
    let staticModel;
    let sheetId;
    let sseState = catalog.store().global().sseState;
    let workbook = catalog.store().workbooks()[
        options.workbook.toCamelCase()
    ];
    let config = workbook.getConfig();
    let receiverKey = f.createId();
    let vm = {};

    sheetId = config.find(function (sheet) {
        return sheet.name.toSpinalCase() === options.key;
    }).id;

    // ..........................................................
    // PUBLIC
    //

    vm.actions = function () {
        let menu;
        let actions = vm.sheet().actions || [];
        let selections = vm.tableWidget().selections();

        menu = actions.map(function (action) {
            let opts;
            let actionIcon;
            let method = staticModel[action.method];

            action.id = action.id || f.createId();

            opts = {
                id: action.id,
                class: "pure-menu-link",
                title: action.title
            };

            if (
                action.validator &&
                !staticModel[action.validator](selections)
            ) {
                opts.class = "pure-menu-link pure-menu-disabled";
            } else {
                opts.onclick = method.bind(null, vm);
            }

            if (action.hasSeparator) {
                opts.class += " fb-menu-list-separator";
            }

            if (action.icon) {
                actionIcon = [m("i", {
                    class: "fa fa-" + action.icon + " fb-menu-list-icon"
                })];
            }

            return m("li", opts, actionIcon, action.name);
        });

        return menu;
    };
    vm.buttonClear = stream();
    vm.buttonDelete = stream();
    vm.buttonEdit = stream();
    vm.buttonNew = stream();
    vm.buttonRefresh = stream();
    vm.buttonSave = stream();
    vm.buttonUndo = stream();
    vm.config = stream(config);
    vm.confirmDialog = stream(dialog.viewModel({
        icon: "question-circle",
        title: "Confirmation"
    }));
    vm.configureSheet = function () {
        let dlg = vm.sheetConfigureDialog();
        dlg.onCancel(undefined);
        dlg.sheetId(sheetId);
        dlg.show();
    };
    vm.footerId = stream(f.createId());
    vm.deleteSheet = function (ev) {
        let doDelete;
        let idx = ev.dataTransfer.getData("text") - 0;
        let confirmDialog = vm.confirmDialog();

        doDelete = function () {
            let activeSheetId = vm.sheet().id;
            let deleteSheetId = vm.config()[idx].id;

            vm.config().splice(idx, 1);
            if (activeSheetId === deleteSheetId) {
                if (idx === vm.config().length) {
                    idx -= 1;
                }
                vm.tabClicked(config[idx].name);
            }
        };

        confirmDialog.message(
            "Are you sure you want to delete this sheet?"
        );
        confirmDialog.icon("question-circle");
        confirmDialog.onOk(doDelete);
        confirmDialog.show();
    };
    vm.filter = f.prop();
    vm.filterDialog = stream();
    vm.goHome = function () {
        m.route.set("/home");
    };
    vm.goSettings = function () {
        m.route.set("/settings/:settings", {
            settings: workbook.data.launchConfig().settings
        });
        vm.showMenu(false);
    };
    vm.isDraggingTab = stream(false);
    vm.hasSettings = stream(
        Boolean(workbook.data.launchConfig().settings)
    );
    vm.modelNew = function () {
        let form = vm.sheet().form || {};
        if (!vm.tableWidget().modelNew()) {
            m.route.set("/edit/:feather/:key", {
                feather: feather.name.toSpinalCase(),
                key: f.createId()
            }, {
                state: {
                    form: form.id,
                    receiver: receiverKey,
                    create: true
                }
            });
        }
    };
    vm.modelOpen = function () {
        let selection = vm.tableWidget().selection();
        let sheet = vm.sheet() || {};
        let form = sheet.form || {};
        let type = vm.tableWidget().model().data.objectType();

        if (selection) {
            m.route.set("/edit/:feather/:key", {
                feather: type,
                key: selection.id()
            }, {
                state: {
                    form: form.id,
                    receiver: receiverKey
                }
            });
        }
    };
    vm.menu = stream(navigator.viewModel());
    vm.newSheet = function () {
        let undo;
        let newSheet;
        let sheetName;
        let next;
        let dialogSheetConfigure = vm.sheetConfigureDialog();
        let id = f.createId();
        let sheets = vm.sheets();
        let sheet = f.copy(vm.sheet());
        let i = 0;

        while (!sheetName) {
            i += 1;
            next = "Sheet" + i;
            if (sheets.indexOf(next) === -1) {
                sheetName = next;
            }
        }

        i = 0;

        newSheet = {
            id: id,
            name: sheetName,
            feather: sheet.feather,
            list: {
                columns: sheet.list.columns
            }
        };

        undo = function () {
            vm.config().pop();
            dialogSheetConfigure.onCancel(undefined);
        };

        vm.config().push(newSheet);
        dialogSheetConfigure.sheetId(id);
        dialogSheetConfigure.onCancel(undo);
        dialogSheetConfigure.show();
    };
    vm.ondragend = function () {
        vm.isDraggingTab(false);
    };
    vm.ondragover = function (ev) {
        ev.preventDefault();
    };
    vm.ondragstart = function (idx, ev) {
        vm.isDraggingTab(true);
        ev.dataTransfer.setData("text", idx);
    };
    vm.ondrop = function (toIdx, ary, ev) {
        let moved;
        let fromIdx;

        ev.preventDefault();
        fromIdx = ev.dataTransfer.getData("text") - 0;
        if (fromIdx !== toIdx) {
            moved = ary.splice(fromIdx, 1)[0];
            ary.splice(toIdx, 0, moved);
        }
        vm.isDraggingTab(false);
    };
    vm.onkeydown = function (ev) {
        let key = ev.key || ev.keyIdentifier;

        switch (key) {
        case "Up":
        case "ArrowUp":
            vm.tableWidget().goPrevRow();
            break;
        case "Down":
        case "ArrowDown":
            vm.tableWidget().goNextRow();
            break;
        }
    };
    vm.onmouseoveractions = function () {
        vm.showActions(true);
    };
    vm.onmouseoutactions = function (ev) {
        if (
            !ev || !ev.toElement || !ev.toElement.id ||
            ev.toElement.id.indexOf("nav-") === -1
        ) {
            vm.showActions(false);
        }
    };
    vm.onmouseovermenu = function () {
        vm.showMenu(true);
    };
    vm.onmouseoutmenu = function (ev) {
        if (
            !ev || !ev.toElement || !ev.toElement.id ||
            ev.toElement.id.indexOf("nav-") === -1
        ) {
            vm.showMenu(false);
        }
    };
    vm.refresh = function () {
        vm.tableWidget().refresh();
    };
    vm.revert = function () {
        let workbookJSON = vm.workbook().toJSON();
        let localConfig = vm.config();
        let defaultConfig = workbookJSON.defaultConfig;
        let sheet = defaultConfig[0];

        localConfig.length = 0;
        defaultConfig.forEach(function (item) {
            localConfig.push(item);
        });
        workbookJSON.localConfig = localConfig;
        m.route.set("/workbook/:workbook/:sheet", {
            workbook: workbookJSON.name.toSpinalCase(),
            sheet: sheet.name.toSpinalCase()
        });
    };
    vm.searchInput = stream();
    vm.share = function () {
        let doShare;
        let confirmDialog = vm.confirmDialog();

        doShare = function () {
            workbook.data.localConfig(vm.config());
            workbook.save();
        };

        confirmDialog.message(
            "Are you sure you want to share your workbook " +
            "configuration with all other users?"
        );
        confirmDialog.icon("question-circle");
        confirmDialog.onOk(doShare);
        confirmDialog.show();
    };
    vm.sheet = function (id, value) {
        let idx = 0;

        if (id) {
            if (typeof id === "object") {
                value = id;
                id = sheetId;
            }
        } else {
            id = sheetId;
        }

        if (currentSheet && currentSheet.id === id && !value) {
            return currentSheet;
        }

        config.some(function (item) {
            if (id === item.id) {
                return true;
            }
            idx += 1;
        });
        if (value) {
            vm.config().splice(idx, 1, value);
        }
        currentSheet = vm.config()[idx];

        return currentSheet;
    };
    vm.sheets = function () {
        return vm.config().map(function (sheet) {
            return sheet.name;
        });
    };
    vm.sheetConfigureDialog = stream();
    vm.showFilterDialog = function () {
        if (vm.tableWidget().models().canFilter()) {
            vm.filterDialog().show();
        }
    };
    vm.showActions = stream(false);
    vm.showMenu = stream(false);
    vm.showSortDialog = function () {
        if (vm.tableWidget().models().canFilter()) {
            vm.sortDialog().show();
        }
    };
    vm.sortDialog = stream();
    vm.sseErrorDialog = stream(dialog.viewModel({
        icon: "close",
        title: "Connection Error",
        message: (
            "You have lost connection to the server. " +
            "Click \"Ok\" to attempt to reconnect."
        ),
        onOk: function () {
            document.location.reload();
        }
    }));
    vm.sseErrorDialog().buttonCancel().hide();
    vm.tabClicked = function (sheet) {
        m.route.set("/workbook/:workbook/:sheet", {
            workbook: workbook.data.name().toSpinalCase(),
            sheet: sheet.toSpinalCase()
        });
    };
    vm.tableWidget = stream();
    vm.workbook = function () {
        return workbook;
    };
    vm.zoom = function (value) {
        let w = vm.tableWidget();
        if (value !== undefined) {
            w.zoom(value);
        }
        return w.zoom();
    };

    // ..........................................................
    // PRIVATE
    //
    feather = catalog.getFeather(vm.sheet().feather);
    staticModel = catalog.store().models()[feather.name.toCamelCase()];

    // Register callback
    catalog.register("receivers", receiverKey, {
        callback: function (model) {
            let tableModel = vm.tableWidget().selection();

            if (!(tableModel && tableModel.id() === model.id())) {
                vm.tableWidget().models().add(model, true);
            }
        }
    });

    // Create search widget view model
    vm.searchInput(searchInput.viewModel({
        refresh: vm.refresh
    }));

    // Create table widget view model
    vm.tableWidget(tableWidget.viewModel({
        config: vm.sheet().list,
        isEditModeEnabled: vm.sheet().isEditModeEnabled,
        feather: vm.sheet().feather,
        search: vm.searchInput().value,
        ondblclick: vm.modelOpen,
        subscribe: true,
        footerId: vm.footerId()
    }));

    // Create dialog view models
    vm.filterDialog(filterDialog.viewModel({
        filter: vm.tableWidget().filter,
        list: vm.tableWidget().models(),
        feather: feather
    }));

    vm.sheetConfigureDialog(sheetConfigureDialog.viewModel({
        parentViewModel: vm,
        sheetId: sheetId
    }));

    vm.sortDialog(sortDialog.viewModel({
        filter: vm.tableWidget().filter,
        list: vm.tableWidget().models(),
        feather: feather
    }));

    // Create button view models
    vm.buttonEdit(button.viewModel({
        onclick: vm.tableWidget().toggleMode,
        title: "Edit mode",
        hotkey: "E",
        icon: "pencil",
        class: "fb-toolbar-button"
    }));
    if (!vm.tableWidget().isEditModeEnabled()) {
        vm.buttonEdit().disable();
    }

    vm.buttonSave(button.viewModel({
        onclick: vm.tableWidget().save,
        label: "&Save",
        icon: "cloud-upload",
        class: "fb-toolbar-button"
    }));
    vm.buttonSave().hide();

    vm.buttonNew(button.viewModel({
        onclick: vm.modelNew,
        label: "&New",
        icon: "plus-circle",
        class: "fb-toolbar-button"
    }));

    vm.buttonDelete(button.viewModel({
        onclick: vm.tableWidget().modelDelete,
        label: "&Delete",
        icon: "remove",
        class: "fb-toolbar-button"
    }));
    vm.buttonDelete().disable();

    if (feather.isReadOnly) {
        vm.buttonNew().disable();
        vm.buttonNew().title("Table is read only");
        vm.buttonDelete().title("Table is read only");
    }

    vm.buttonUndo(button.viewModel({
        onclick: vm.tableWidget().undo,
        label: "&Undo",
        icon: "undo",
        class: "fb-toolbar-button"
    }));

    vm.buttonRefresh(button.viewModel({
        onclick: vm.refresh,
        title: "Refresh",
        hotkey: "R",
        icon: "refresh",
        class: "fb-toolbar-button"
    }));

    vm.buttonClear(button.viewModel({
        onclick: vm.searchInput().clear,
        title: "Clear search",
        hotkey: "C",
        icon: "eraser",
        class: "fb-toolbar-button"
    }));

    // Bind button states to list statechart events
    listState = vm.tableWidget().models().state();
    listState.resolve("/Fetched").enter(function () {
        let model = vm.tableWidget().selection();

        if (model && model.canUndo()) {
            vm.buttonDelete().hide();
            vm.buttonUndo().show();
            return;
        }

        vm.buttonDelete().show();
        vm.buttonUndo().hide();
    });
    listState.resolve("/Fetched/Clean").enter(function () {
        vm.buttonSave().disable();
    });
    listState.state().resolve("/Fetched/Dirty").enter(function () {
        vm.buttonSave().enable();
    });

    // Bind button states to search statechart events
    searchState = vm.searchInput().state();
    searchState.resolve("/Search/On").enter(function () {
        vm.buttonClear().enable();
    });
    searchState.resolve("/Search/Off").enter(function () {
        vm.buttonClear().disable();
    });

    // Bind buttons to table widget state change events
    tableState = vm.tableWidget().state();
    tableState.resolve("/Mode/View").enter(function () {
        vm.buttonEdit().deactivate();
        vm.buttonSave().hide();
    });
    tableState.resolve("/Mode/Edit").enter(function () {
        vm.buttonEdit().activate();
        vm.buttonSave().show();
    });
    tableState.resolve("/Selection/Off").enter(function () {
        vm.buttonDelete().disable();
        vm.buttonDelete().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On").enter(function () {
        let canDelete = function (selection) {
            return selection.canDelete();
        };
        let enableButton = vm.tableWidget().selections().some(canDelete);

        if (enableButton) {
            vm.buttonDelete().enable();
        } else {
            vm.buttonDelete().disable();
        }
    });
    tableState.resolve("/Selection/On/Clean").enter(function () {
        vm.buttonDelete().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On/Dirty").enter(function () {
        vm.buttonDelete().hide();
        vm.buttonUndo().show();
    });

    sseState.resolve("Error").enter(function () {
        vm.sseErrorDialog().show();
    });

    return vm;
};

// Define workbook component
workbookPage.component = {
    oninit: function (vnode) {
        let workbook = vnode.attrs.workbook;
        let sheet = vnode.attrs.key;
        let viewModels = catalog.register("workbookViewModels");

        if (viewModels[workbook] && viewModels[workbook][sheet]) {
            this.viewModel = viewModels[workbook][sheet];
            return;
        }

        this.viewModel = workbookPage.viewModel(vnode.attrs);
        this.viewModel.menu().selected(workbook);

        // Memoize the model for total state persistence
        if (!viewModels[workbook]) {
            viewModels[workbook] = {};
        }

        viewModels[workbook][sheet] = this.viewModel;
    },

    onupdate: function (vnode) {
        this.viewModel.menu().selected(vnode.attrs.workbook);
    },

    view: function () {
        let filterMenuClass;
        let tabs;
        let vm = this.viewModel;
        let createTabClass = "pure-button fb-workbook-tab-edit";
        let deleteTabClass = "pure-button fb-workbook-tab-edit";
        let activeSheet = vm.sheet();
        let config = vm.config();
        let idx = 0;
        let actionsDisabled = (
            !Array.isArray(activeSheet.actions) ||
            !activeSheet.actions.length
        );

        // Build tabs
        tabs = vm.sheets().map(function (sheet) {
            let tab;
            let tabOpts;

            // Build tab
            tabOpts = {
                class: (
                    "fb-workbook-tab pure-button" + (
                        activeSheet.name.toName() === sheet.toName()
                        ? " pure-button-primary"
                        : ""
                    )
                ),
                onclick: vm.tabClicked.bind(this, sheet)
            };

            if (vm.config().length > 1) {
                tabOpts.ondragover = vm.ondragover;
                tabOpts.draggable = true;
                tabOpts.ondragstart = vm.ondragstart.bind(this, idx);
                tabOpts.ondrop = vm.ondrop.bind(this, idx, config);
                tabOpts.ondragend = vm.ondragend;
                tabOpts.class += " fb-workbook-tab-draggable";
            }

            tab = m("button[type=button]", tabOpts, sheet.toName());
            idx += 1;

            return tab;
        });

        // Create/delete tab buttons
        if (vm.isDraggingTab()) {
            createTabClass += " fb-workbook-tab-edit-hide";
            deleteTabClass += " fb-workbook-tab-edit-show";
        } else {
            createTabClass += " fb-workbook-tab-edit-show";
            deleteTabClass += " fb-workbook-tab-edit-hide";
        }

        tabs.push(m("button[type=button]", {
            class: createTabClass,
            title: "Add sheet",
            onclick: vm.newSheet
        }, [m("i", {
            class: "fa fa-plus"
        })]));

        // Delete target
        tabs.push(m("div", {
            class: deleteTabClass,
            ondragover: vm.ondragover,
            ondrop: vm.deleteSheet
        }, [m("i", {
            class: "fa fa-trash"
        })]));

        // Finally assemble the whole view
        filterMenuClass = "pure-menu-link";
        if (!vm.tableWidget().models().canFilter()) {
            filterMenuClass += " pure-menu-disabled";
        }

        return m("div", {
            class: "pure-form"
        }, [
            m(sortDialog.component, {
                viewModel: vm.sortDialog()
            }),
            m(sortDialog.component, {
                viewModel: vm.filterDialog()
            }),
            m(sheetConfigureDialog.component, {
                viewModel: vm.sheetConfigureDialog()
            }),
            m(dialog.component, {
                viewModel: vm.confirmDialog()
            }),
            m(dialog.component, {
                viewModel: vm.sseErrorDialog()
            }),
            m("div", {
                class: "fb-navigator-menu-container"
            }, [
                m(navigator.component, {
                    viewModel: vm.menu()
                }),
                m("div", [
                    m("div", {
                        id: "toolbar",
                        class: "fb-toolbar",
                        onkeydown: vm.onkeydown
                    }, [
                        m(button.component, {
                            viewModel: vm.buttonEdit()
                        }),
                        m("div", {
                            id: "nav-div",
                            class: (
                                "pure-menu " +
                                "custom-restricted-width " +
                                "fb-menu"
                            ),
                            onmouseover: vm.onmouseoveractions,
                            onmouseout: vm.onmouseoutactions
                        }, [
                            m("span", {
                                id: "nav-button",
                                class: (
                                    "pure-button " +
                                    "fa fa-bolt " +
                                    "fb-menu-button"
                                ),
                                disabled: actionsDisabled
                            }),
                            m("ul", {
                                id: "nav-menu-list",
                                class: (
                                    "pure-menu-list fb-menu-list" + (
                                        vm.showActions()
                                        ? " fb-menu-list-show"
                                        : ""
                                    )
                                )
                            }, vm.actions())
                        ]),
                        m(button.component, {
                            viewModel: vm.buttonSave()
                        }),
                        m(button.component, {
                            viewModel: vm.buttonNew()
                        }),
                        m(button.component, {
                            viewModel: vm.buttonDelete()
                        }),
                        m(button.component, {
                            viewModel: vm.buttonUndo()
                        }),
                        m(searchInput.component, {
                            viewModel: vm.searchInput()
                        }),
                        m(button.component, {
                            viewModel: vm.buttonRefresh()
                        }),
                        m(button.component, {
                            viewModel: vm.buttonClear()
                        }),
                        m("div", {
                            id: "nav-div",
                            class: (
                                "pure-menu " +
                                "custom-restricted-width " +
                                "fb-menu"
                            ),
                            onmouseover: vm.onmouseovermenu,
                            onmouseout: vm.onmouseoutmenu
                        }, [
                            m("span", {
                                id: "nav-button",
                                class: (
                                    "pure-button " +
                                    "fa fa-gear " +
                                    "fb-menu-button"
                                )
                            }),
                            m("ul", {
                                id: "nav-menu-list",
                                class: (
                                    "pure-menu-list fb-menu-list" + (
                                        vm.showMenu()
                                        ? " fb-menu-list-show"
                                        : ""
                                    )
                                )
                            }, [
                                m("li", {
                                    id: "nav-sort",
                                    class: filterMenuClass,
                                    title: "Change sheet sort",
                                    onclick: vm.showSortDialog
                                }, [m("i", {
                                    class: "fa fa-sort fb-menu-list-icon"
                                })], "Sort"),
                                m("li", {
                                    id: "nav-filter",
                                    class: filterMenuClass,
                                    title: "Change sheet filter",
                                    onclick: vm.showFilterDialog
                                }, [m("i", {
                                    class: "fa fa-filter fb-menu-list-icon"
                                })], "Filter"),
                                /*
                                m("li", {
                                  id: "nav-format",
                                  class: (
                                        "pure-menu-link " +
                                        "pure-menu-disabled"
                                  ),
                                  title: "Format sheet"
                                  //onclick: vm.showFormatDialog
                                }, [m("i", {class: (
                                    "fa fa-paint-brush " +
                                    "fb-menu-list-icon"
                                ),
                                })], "Format"),
                                m("li", {
                                  id: "nav-subtotal",
                                  class: (
                                        "pure-menu-link " +
                                        "pure-menu-disabled"
                                  ),
                                  title: "Edit subtotals"
                                }, [m("div", {style: {
                                  display: "inline",
                                  fontWeight: "bold",
                                  fontStyle: "Italic"
                                }}, "∑")], " Totals"),
                                */
                                m("li", {
                                    id: "nav-configure",
                                    class: (
                                        "pure-menu-link " +
                                        "fb-menu-list-separator"
                                    ),
                                    title: "Configure current worksheet",
                                    onclick: vm.configureSheet
                                }, [m("i", {
                                    class: "fa fa-gear  fb-menu-list-icon"
                                })], "Configure"),
                                m("li", {
                                    id: "nav-share",
                                    class: "pure-menu-link",
                                    title: "Share workbook configuration",
                                    onclick: vm.share
                                }, [m("i", {
                                    class: (
                                        "fa fa-share-alt " +
                                        "fb-menu-list-icon"
                                    )
                                })], "Share"),
                                m("li", {
                                    id: "nav-revert",
                                    class: "pure-menu-link",
                                    title: (
                                        "Revert workbook configuration " +
                                        "to original state"
                                    ),
                                    onclick: vm.revert
                                }, [m("i", {
                                    class: "fa fa-reply fb-menu-list-icon"
                                })], "Revert"),
                                m("li", {
                                    id: "nav-settings",
                                    class: (
                                        "pure-menu-link " +
                                        "fb-menu-list-separator" + (
                                            vm.hasSettings()
                                            ? ""
                                            : " pure-menu-disabled"
                                        )
                                    ),
                                    title: "Change module settings",
                                    onclick: vm.goSettings
                                }, [m("i", {
                                    class: "fa fa-wrench fb-menu-list-icon"
                                })], "Settings")
                            ])
                        ])
                    ]),
                    m(tableWidget.component, {
                        viewModel: vm.tableWidget()
                    }),
                    m("div", {
                        id: vm.footerId()
                    }, [
                        tabs,
                        m("i", {
                            class: (
                                "fa fa-search-plus " +
                                "fb-zoom-icon fb-zoom-right-icon"
                            )
                        }),
                        m("input", {
                            class: "fb-zoom-control",
                            title: "Zoom " + vm.zoom() + "%",
                            type: "range",
                            step: "5",
                            min: "50",
                            max: "150",
                            value: vm.zoom(),
                            oninput: (e) => vm.zoom(e.target.value)
                        }),
                        m("i", {
                            class: (
                                "fa fa-search-minus " +
                                "fb-zoom-icon fb-zoom-left-icon"
                            )
                        })
                    ])
                ])
            ])
        ]);
    }
};

catalog.register("components", "workbookPage", workbookPage.component);
export {workbookPage};