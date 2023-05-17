import {concatenateUrls, consumeUrl, getUrlParameters, isMatchingUrl, isSameUrl} from "./NavigationUtils.js";
import Listenable from "juis-commons/Listenable.js";
import {NOT_FOUND} from "juis-commons/Errors.js";
import {
    AFTER_NAVIGATION,
    BEFORE_NAVIGATION,
    NAVIGATE,
    REQUEST_NAVIGATE,
    SHOW_ERROR,
    SHOW_LOADING,
    SHOW_NOT_FOUND,
    SHOW_PAGE
} from "./Events.js";

/**
 * @Mixin Listenable
 * @param dynamicImport
 * @param loadingPage
 * @param notFoundPage
 * @param errorPage
 * @constructor
 */
function Router(dynamicImport, loadingPage, notFoundPage, errorPage) {
    let routes = [];
    let currentComponent = loadingPage;
    let currentRoute;
    let fallbackRoute;
    let showComponent = function (newComponent) {
        if (currentComponent !== newComponent) {
            if (currentComponent.getNode().hasParent()) {
                currentComponent.getNode().replaceSelf(newComponent.getNode());
            }
            currentComponent = newComponent;
            window.scrollTo(0, 0);
        }
    };

    let findMatchingRoute = function (url) {
        return routes.find(route => isMatchingUrl(url, route.url));
    };
    this.setFallbackRoute = function (url) {
        fallbackRoute = {...findMatchingRoute(url), url};
    };

    let getComponentForRoute = (route, consumedUrl) => {
        return new Promise((resolve) => {
            if (route.component && !route.component.isDestroyed()) {
                resolve(route.component);
            } else if (route.components[consumedUrl] && !route.components[consumedUrl].isDestroyed()) {
                resolve(route.components[consumedUrl]);
            } else if (route.componentConstructor) {
                let component = route.componentConstructor.call();
                component.nextListenable = this;
                if (!route.parameters.alwaysReload) {
                    route.components[consumedUrl] = component;
                }
                resolve(component);
            } else {
                loadingPage.setText("Waiting");
                showComponent(loadingPage);
                let path = route.path;
                if (path.startsWith("/src/")) {
                    path = path.substring("/src/".length);
                }
                dynamicImport(path).then(module => {
                    let component = getComponentFromModule(module, route);
                    if (!route.parameters.alwaysReload) {
                        route.components[consumedUrl] = component;
                    }
                    resolve(component);
                }).catch(e => {
                    resolve(errorPage);
                    // We have no good information about what went wrong. But it might be due to using an outdated
                    // in case a new backend version has been deployed after loading the web page.
                    this.triggerOnce("checkVersion");
                    console.warn(`Could not load module at ${route.path}.`, e);
                    throw e;
                });
            }
        });
    };

    let getComponentFromModule = (module, route) => {
        let componentName = route.componentName || "default";
        let component;
        if (typeof module[componentName] === "object") {
            component = module[componentName];
        } else {
            component = new module[componentName]();
        }
        component.nextListenable = this;
        return component;
    };

    let routerBaseUrl = "";
    let currentUrl;
    let navigate = (route, url, consumedUrl, matchingUrlPart, dynamicParameters) => {
        if (isSameUrl(currentUrl, consumedUrl)) {
            // No need to act if the url didn't change. Just propagate in case something on a lower level has changed.
            triggerNewNavigateEvent(route, url, consumedUrl, matchingUrlPart, dynamicParameters, currentComponent);
            return;
        }
        if (currentRoute && currentRoute.parameters.alwaysReload) {
            currentComponent.destroy();
            currentUrl = null;
        }
        currentRoute = route;
        getComponentForRoute(route, consumedUrl).then(component => {
            if (route !== currentRoute) {
                // While waiting for the component, there has already been another navigation changing the current route
                // It is possible that the other navigations component-promise finished faster, and it is already
                // showing the correct component. Even if it isn't finished yet, changing the component now when we know
                // will quickly change again will just cause unuseful redraws of the UI. Therefore we return without
                // doing anything.
                return;
            }
            this.trigger(BEFORE_NAVIGATION, {url, consumedUrl, routerBaseUrl}, {propagating: false});
            const navigationData = triggerNewNavigateEvent(route, url, consumedUrl, matchingUrlPart, dynamicParameters, component);
            component.whenReady().then(() => {
                showComponent(component);
                currentUrl = consumedUrl;
                this.trigger(AFTER_NAVIGATION, navigationData, {propagating: false});
            });
        }).catch(e => {
            showComponent(errorPage);
            throw e;
        });
    };

    this.whenReady = () => Promise.resolve();

    let triggerNewNavigateEvent = function (route, url, consumedUrl, matchingUrlPart, dynamicParameters, component) {
        const parameters = {...dynamicParameters, ...getUrlParameters(matchingUrlPart, route)};
        const eventData = {url, consumedUrl, routerBaseUrl, parameters};
        component.trigger(NAVIGATE, eventData, {propagating: false});
        return eventData;
    };

    let baseViewPath = "";

    this.setViewsBasePath = viewsBasePath => baseViewPath = viewsBasePath;

    /**
     * Add a component to this route
     * @param url           Show the component for this url
     * @param view          An instance of a component or an url to a module with the component
     * @param parameters    Static parameters in addition to, or overriding, parameters from the url.
     * @param componentName If param component is an url to a module this is the export name to use from that module.
     */
    this.addComponent = function (url, view, parameters = {}, componentName = "default") {
        let components = {};
        if (typeof view === "string") {
            routes.push({url, path: baseViewPath + view, componentName, parameters, components});
        } else if (view.getNode) {
            view.nextListenable = this;
            routes.push({url, component: view, parameters, components});
        } else {
            routes.push({url, componentConstructor: view, router: this, parameters, components});
        }
    };

    this.getNode = function () {
        return currentComponent.getNode();
    };

    this.destroy = function () {
        this.removeAllListeners();
    };

    let parameters = {};
    this.on(NAVIGATE, (navigation, event) => {
        if (!navigation.consumedUrl || navigation.consumedUrl === "/") {
            navigation.consumedUrl = "";
        }
        let matchingUrlPart = navigation.url.substring(navigation.consumedUrl.length);
        let route = findMatchingRoute(matchingUrlPart);
        if (!route) {
            if (fallbackRoute) {
                // Defer the request to the fallback route so that all handling of the current navigation event
                // can finish first.
                Promise.resolve().then(() => {
                    this.triggerOnce(REQUEST_NAVIGATE, {url: fallbackRoute.url, replaceHistory: true});
                });
                // In case other navigation listeners are added to this router, those wont fire when marking the event
                // as resolved.
                event.resolve();
            } else {
                currentRoute = undefined;
                console.warn("could not find route", navigation.url, "among routes", routes);
                showComponent(notFoundPage);
            }
        } else {
            let consumedUrl = concatenateUrls(navigation.consumedUrl, consumeUrl(matchingUrlPart, route.url));
            // Trigger any old parameters again, but overwrite if there are new values.
            parameters = {...parameters, ...navigation.parameters};
            routerBaseUrl = navigation.consumedUrl;
            navigate(route, navigation.url, consumedUrl, matchingUrlPart, parameters);
        }
    });

    let switchedComponent;
    this.on(SHOW_NOT_FOUND, (data, event) => {
        switchedComponent = currentComponent;
        showComponent(notFoundPage);
        event.stopPropagation();
    });
    this.on(SHOW_ERROR, (error, event) => {
        if (error && error.message === NOT_FOUND) {
            switchedComponent = currentComponent;
            showComponent(notFoundPage);
        } else {
            showComponent(errorPage);
            console.log("Should show error in router", error);
        }
        event.stopPropagation();
    });

    this.on(SHOW_LOADING, (data, event) => {
        switchedComponent = currentComponent;
        if (data) {
            loadingPage.setText(data);
        }
        showComponent(loadingPage);
        event.stopPropagation();
    });

    this.on(SHOW_PAGE, (data) => {
        if (switchedComponent) {
            showComponent(switchedComponent);
            switchedComponent = undefined;
        }
    });

    this.on(REQUEST_NAVIGATE, (event) => {
        let url = event.url;
        let parameters = event.parameters;
        if (!url.startsWith("/")) {
            if (document.location.pathname.endsWith("/")) {
                url = document.location.pathname + url;
            } else {
                url = document.location.pathname + "/" + url;
            }
        }

        // If there is a baseUrl we can simply check if the requested url starts with the baseUrl and automatically
        // consume it. If the base url is an empty string however, that means there might be matching routes in a parent
        // router as well. Then we can consume the url only if we find a matching route in this router.
        if ((routerBaseUrl !== "" && url.startsWith(routerBaseUrl)) || (routerBaseUrl === "" && findMatchingRoute(url))) {
            if (event.replaceHistory) {
                history.replaceState(null, "", url);
            } else {
                history.pushState(null, "", url);
            }

            this.trigger(NAVIGATE, {
                url,
                consumedUrl: routerBaseUrl,
                routerBaseUrl,
                parameters
            }, {propagating: false});
        } else {
            return this.triggerOnce(REQUEST_NAVIGATE, {...event}, {skipOrigin: true});
        }
    });
}

Listenable.apply(Router.prototype);

export {Router as default};
