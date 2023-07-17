let isMatchingUrl = (url, pattern) => {
    if (pattern instanceof RegExp) {
        if (!url.startsWith("/")) {
            return pattern.test(url) || pattern.test("/" + url);
        }
        if (url.startsWith("/")) {
            return pattern.test(url) || pattern.test(url.substring(1));
        }
    } else if (typeof pattern === "string") {
        if (!pattern.startsWith("/")) {
            pattern = "/" + pattern;
        }
        if (!url.startsWith("/")) {
            url = "/" + url;
        }
        return url.startsWith(pattern);
    }
};

let getUrlParameters = (url, route) => {
    let urlParams = [];
    if (route.url instanceof RegExp) {
        let matches = url.match(route.url);
        if (matches && matches.length > 1) {
            urlParams = matches.slice(1);
        }
    }
    if (Array.isArray(route.parameters.urlParameterNames)) {
        let params = {...route.parameters};
        route.parameters.urlParameterNames.forEach((name, index) => params[name] = urlParams[index]);
        delete params.urlParameterNames;
        return params;
    } else {
        return {...route.parameters, ...urlParams, urlParameters: urlParams};
    }
};

const matchUrl = (url, pattern) => {
    let matches = url.match(pattern);
    if (matches === null && url.startsWith("/")) {
        matches = url.substring(1).match(pattern);
    } else if (matches === null && !url.startsWith("/")) {
        matches = ("/" + url).match(pattern);
    }
    return matches;
};

let consumeUrl = (url, pattern) => {
    if (!pattern) {
        return "";
    } else if (pattern instanceof RegExp) {
        let matches = matchUrl(url, pattern);
        if (matches === null) {
            throw new Error(`Cannot consume url ${url} that does not match pattern ${pattern.toString()}`);
        }
        return url.substring(0, matches[0].length);
    } else {
        if (!pattern.startsWith("/")) {
            pattern = "/" + pattern;
        }
        return url.substring(0, pattern.length);
    }
};

let concatenateUrls = (...urls) => {
    return urls
        .filter(url => !!url)
        .map(url => url.toString())
        .map((url, index) => {
            if (index > 0 && url.startsWith("/")) {
                url = url.substring(1);
            }
            if (index !== urls.length - 1 && url.endsWith("/")) {
                url = url.substring(0, url.length - 1);
            }
            return url;
        })
        .join("/");
};

const isSameUrl = (url1, url2) => {
    if (typeof url1 !== "string" || typeof url2 !== "string") {
        return false;
    }
    if (!url1.startsWith("/")) {
        url1 = "/" + url1;
    }
    if (!url2.startsWith("/")) {
        url2 = "/" + url2;
    }
    if (!url1.endsWith("/")) {
        url1 = url1 + "/";
    }
    if (!url2.endsWith("/")) {
        url2 = url2 + "/";
    }
    return url1 === url2;
};

export {isMatchingUrl, getUrlParameters, consumeUrl, concatenateUrls, isSameUrl};
