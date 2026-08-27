sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/ui/thirdparty/jquery",
    "com/manufacturing/erp/manufacturingerp/model/formatter"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, jQuery, formatter) {
    "use strict";

    return Controller.extend("com.manufacturing.erp.manufacturingerp.controller.Dashboard", {
        formatter: formatter,

        onInit: function () {
            this.getView().setModel(new JSONModel({
                productsCount: 0,
                suppliersCount: 0,
                materialsCount: 0,
                bomsCount: 0,
                inventoryByCategory: [],
                productsByStatus: [],
                recentProducts: [],
                categories: [],
                statuses: [],
                filters: {
                    category: "",
                    status: ""
                },
                busy: false,
                hasError: false
            }), "dashboard");

            this._bFilterOptionsLoaded = false;
            this.getOwnerComponent().getRouter().getRoute("dashboard").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this._loadDashboardData();
        },

        onApplyFilters: function () {
            this._loadDashboardData();
        },

        onClearFilters: function () {
            var oDashboardModel = this.getView().getModel("dashboard");
            oDashboardModel.setProperty("/filters/category", "");
            oDashboardModel.setProperty("/filters/status", "");
            this._loadDashboardData();
        },

        onRefresh: function () {
            this._loadDashboardData(true);
        },

        _loadDashboardData: function (bShowRefreshMessage) {
            var oDashboardModel = this.getView().getModel("dashboard");
            var oFilters = oDashboardModel.getProperty("/filters");
            var aMaterialFilters = [];
            var aProductFilters = [];

            if (oFilters.category) {
                aMaterialFilters.push(new Filter("Category", FilterOperator.EQ, oFilters.category));
            }
            if (oFilters.status) {
                aProductFilters.push(new Filter("Status", FilterOperator.EQ, oFilters.status));
            }

            oDashboardModel.setProperty("/busy", true);
            oDashboardModel.setProperty("/hasError", false);

            var aRequests = [
                this._readCount("/Product/$count"),
                this._readCount("/Supplier/$count"),
                this._readCount("/Material/$count"),
                this._readCount("/BOM/$count"),
                this._readCollection("/Material", aMaterialFilters, {
                    "$select": "MaterialId,MaterialName,Category,CurrentStock,Status"
                }),
                this._readCollection("/Product", aProductFilters, {
                    "$select": "ProductId,ProductName,Category,Status,LastChangedAt"
                })
            ];

            return jQuery.when.apply(jQuery, aRequests).done(function () {
                var aResults = Array.prototype.slice.call(arguments);
                var bHasError = aResults.some(function (oResult) {
                    return oResult.hasError;
                });
                var aMaterials = this._getResponseValue(aResults[4]);
                var aProducts = this._getResponseValue(aResults[5]);

                oDashboardModel.setProperty("/productsCount", this._getResponseValue(aResults[0]));
                oDashboardModel.setProperty("/suppliersCount", this._getResponseValue(aResults[1]));
                oDashboardModel.setProperty("/materialsCount", this._getResponseValue(aResults[2]));
                oDashboardModel.setProperty("/bomsCount", this._getResponseValue(aResults[3]));
                oDashboardModel.setProperty("/inventoryByCategory", this._aggregateInventory(aMaterials));
                oDashboardModel.setProperty("/productsByStatus", this._aggregateProductsByStatus(aProducts));
                oDashboardModel.setProperty("/recentProducts", this._getRecentProducts(aProducts));

                if (!this._bFilterOptionsLoaded) {
                    oDashboardModel.setProperty("/categories", this._toFilterOptions(aMaterials, "Category"));
                    oDashboardModel.setProperty("/statuses", this._toFilterOptions(aProducts, "Status"));
                    this._bFilterOptionsLoaded = true;
                }

                oDashboardModel.setProperty("/hasError", bHasError);
                if (bShowRefreshMessage && !bHasError) {
                    MessageToast.show(this._getText("dashboardRefreshed"));
                }
            }.bind(this)).always(function () {
                oDashboardModel.setProperty("/busy", false);
            });
        },

        _readCount: function (sPath) {
            var oModel = this.getOwnerComponent().getModel();
            var oDeferred = jQuery.Deferred();
            oModel.read(sPath, {
                success: function (vCount) {
                    oDeferred.resolve({
                        value: parseInt(vCount, 10) || 0,
                        hasError: false
                    });
                },
                error: function () {
                    oDeferred.resolve({
                        value: 0,
                        hasError: true
                    });
                }
            });
            return oDeferred.promise();
        },

        _readCollection: function (sPath, aFilters, mUrlParameters) {
            var oModel = this.getOwnerComponent().getModel();
            var oDeferred = jQuery.Deferred();
            oModel.read(sPath, {
                filters: aFilters,
                urlParameters: mUrlParameters,
                success: function (oData) {
                    oDeferred.resolve({
                        value: oData.results || [],
                        hasError: false
                    });
                },
                error: function () {
                    oDeferred.resolve({
                        value: [],
                        hasError: true
                    });
                }
            });
            return oDeferred.promise();
        },

        _getResponseValue: function (oResponse) {
            return oResponse.value;
        },

        _aggregateInventory: function (aMaterials) {
            var mInventory = {};
            var sNotAssigned = this._getText("notAssigned");

            aMaterials.forEach(function (oMaterial) {
                var sCategory = oMaterial.Category || sNotAssigned;
                var fStock = parseFloat(oMaterial.CurrentStock);
                mInventory[sCategory] = (mInventory[sCategory] || 0) + (isNaN(fStock) ? 0 : fStock);
            });

            return Object.keys(mInventory).sort().map(function (sCategory) {
                return {
                    category: sCategory,
                    stock: mInventory[sCategory]
                };
            });
        },

        _aggregateProductsByStatus: function (aProducts) {
            var mStatuses = {};
            var sNotAssigned = this._getText("notAssigned");

            aProducts.forEach(function (oProduct) {
                var sStatus = oProduct.Status || sNotAssigned;
                mStatuses[sStatus] = (mStatuses[sStatus] || 0) + 1;
            });

            return Object.keys(mStatuses).sort(function (sFirst, sSecond) {
                return this._getStatusSortOrder(sFirst) - this._getStatusSortOrder(sSecond);
            }.bind(this)).map(function (sStatus) {
                return {
                    status: sStatus,
                    count: mStatuses[sStatus]
                };
            });
        },

        _getStatusSortOrder: function (sStatus) {
            switch (sStatus.toLowerCase()) {
            case "active":
                return 0;
            case "inactive":
                return 1;
            default:
                return 2;
            }
        },

        _toFilterOptions: function (aRecords, sProperty) {
            var mValues = {};
            aRecords.forEach(function (oRecord) {
                if (oRecord[sProperty]) {
                    mValues[oRecord[sProperty]] = true;
                }
            });
            return Object.keys(mValues).sort().map(function (sValue) {
                return {
                    key: sValue,
                    text: sValue
                };
            });
        },

        _getRecentProducts: function (aProducts) {
            return aProducts.slice().sort(function (oFirst, oSecond) {
                return this._toTimestamp(oSecond.LastChangedAt) - this._toTimestamp(oFirst.LastChangedAt);
            }.bind(this)).slice(0, 5);
        },

        _toTimestamp: function (vDate) {
            if (vDate instanceof Date) {
                return vDate.getTime();
            }
            var oMatch = typeof vDate === "string" && /\/Date\((\d+)/.exec(vDate);
            return oMatch ? parseInt(oMatch[1], 10) : (Date.parse(vDate) || 0);
        },

        _getText: function (sKey) {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle().getText(sKey);
        },

        onNavigateToProducts: function () {
            this.getOwnerComponent().getRouter().navTo("product");
        },

        onNavigateToSuppliers: function () {
            this.getOwnerComponent().getRouter().navTo("supplier");
        },

        onNavigateToMaterials: function () {
            this.getOwnerComponent().getRouter().navTo("material");
        },

        onNavigateToBoms: function () {
            this.getOwnerComponent().getRouter().navTo("bom");
        }
    });
});
