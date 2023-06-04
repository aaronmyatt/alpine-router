export default function (Alpine) {
    Alpine.defaultTarget = Alpine.defaultTarget || 'main'
    let target = Alpine.defaultTarget
    const Views = Alpine.reactive({})

    const Router = Alpine.reactive({
        routes: [],
        lastRoute: {},
        query: {},
        queryRaw: '',
        path: '',
        origin: '',
        params: {},
        parts: [],

        push(slug) {
            // separate path from query
            const [path, query] = slug.split('?')
            const paths = paramsFromRoute(dropTrailingSlash(path))
            this.params = paths.params
            this.parts = paths.parts
            this._rawPath = dropTrailingSlash(paths.rawpath)

            const state = {
                url: dropTrailingSlash(paths.pathname),
                target,
            };
            if (query) {
                state.url += `?${query}`
            }
            history.pushState(state, '', state.url)
            this.lastRoute = state;
            this.updateRouterValues();
            return this;
        },
        updateRouterValues() {
            this.query = queryParamsToObject(window.location.search)
            this.queryRaw = window.location.search
            this.path = window.location.pathname
            this.origin = window.location.origin
        },
        _rawPath: '', // <-- internal property, retains params
    })

    window.addEventListener('popstate', (e) => {
        e.preventDefault();
        target = Alpine.defaultTarget
        renderView(Router.lastRoute.target, '');
    })

    Alpine.router = Router;
    Alpine.views = Views;

    Alpine.directive('route', (el, {expression}, {evaluateLater}) => {
        Router.routes.push(el);

        const getRoute = expression.startsWith('/') ? (fn) => fn(expression) : evaluateLater(expression);
        el.addEventListener('click', (e) => {
            getRoute((route) => {
                target = el.getAttribute('x-target') || Alpine.defaultTarget
                if (linkIsInternal(route)) {
                    e && e.preventDefault()
                    Router.push(route)
                }
            })
        })
    })

    Alpine.magic('route', (el, {Alpine}) => expression => {
        target = el.getAttribute('x-target') || Alpine.defaultTarget
        if (linkIsInternal(expression)) {
            Router.push(expression.pathname, query && getQueryParams(`?${query}`))
        }
    })

    Alpine.directive('view', (el, {expression}) => {
        Views[expression] = el;
        Views[expression].parts = expression.split('/').filter(part => part !== '');
    })

    Alpine.effect(() => {
        console.log('wat')
        const templateEl = Views[Router._rawPath]

        if(templateEl){
            if (templateEl.hasAttribute('x-target'))
                target = templateEl.getAttribute('x-target')
            renderLocalOrRemoteView(templateEl, target);
        } else{
            const parts = Router.path.split('/').filter(part => part !== '')
            const likelyTheRightView = Views && Object.entries(Views).find((view) => {
                return view[1].parts.length === parts.length
            })
            if(likelyTheRightView){
                const rawpath =  likelyTheRightView[1]
                    .parts
                    .reduce((rawpath, part, index) => {
                        if(part === parts[index])
                            return rawpath + part + '/'
                        return rawpath + part + ':' + parts[index] + '/'
                    }, '/')
                Alpine.nextTick(() => Router.push(dropTrailingSlash(rawpath)+window.location.search))
            }
        }
    })

    // ensure all views have been parsed then trigger initial view
    const pathname = dropTrailingSlash(window.location.pathname)
    // 👆this may not match a template in the DOM, but it may match a child view in a remote template
    // so we need to see if any of the parent templates in the current html file match a "part" of the
    // pathname and load that view first - much like you would a layout in a traditional router

    const mostLikelyBaseView = pathname.split('/')
        .filter((key) => key !== '')
        .map(part => {
            const key = `/${part}`
            return document.querySelector(`template[x-view="${key}"]`)
        })
        // keep the longest match
        .reduce((longest, current) => {
            if (current && current.getAttribute('x-view').length > longest.getAttribute('x-view').length)
                return current
            return longest
        }, document.querySelector(`[x-view="/"]`))

    document.addEventListener('alpine:init', () => {
        if (mostLikelyBaseView) {
            renderLocalOrRemoteView(mostLikelyBaseView, Alpine.defaultTarget)
                .then(_ => {
                    Router.push(pathname+window.location.search);
                });
        } else {
            Router.push(pathname+window.location.search);
        }
    });
}

function renderLocalOrRemoteView(templateEl, target, initTree = true) {
    if (templateEl.innerHTML.trim() === '') {
        // get first attribute from templateEl that startsWith x-view
        // otherwise "child" templates that rely on a modifier will be skipped
        // const attrName = Array.from(templateEl.attributes).find(attr => attr.name.startsWith('x-view')).name;
        const path = templateEl.getAttribute('x-view');
        return fetch(`${path}.html`)
            .then((response) => response.text())
            .then((html) => {
                templateEl.innerHTML = html
            })
            .then(() => {
                renderView(target, templateEl.innerHTML, initTree);
            })
    } else {
        return Promise.resolve(renderView(target, templateEl.innerHTML, initTree));
    }
}

function renderView(target, html, initTree = true) {
    const notInTheShadowDom = document.querySelector(target)
    if (notInTheShadowDom) {
        notInTheShadowDom.innerHTML = html;
        initTree && Alpine.initTree(notInTheShadowDom);
    } else
        window.components && window.components.map(component => {
            const el = component.shadowRoot.querySelector(target)
            if (el) {
                component.shadowRoot.querySelector(target).innerHTML = html
                initTree && Alpine.initTree(el);
            }
        })
}

function paramsFromRoute(path) {
    return path
        .split('/')
        .filter((key) => key !== '')
        .reduce((paths, pathPart) => {
            paths.parts.push(pathPart);
            // extract key from key if key is "key:value"
            if (pathPart.includes(':')) {
                const [paramKey, paramValue] = pathPart.split(':')
                paths.params[paramKey] = paramValue
                return {
                    pathname: paths['pathname'] + paramValue + '/',
                    rawpath: paths['rawpath'] + paramKey + '/',
                    params: paths['params'],
                    parts: paths['parts'],
                }
            }
            return {
                pathname: paths['pathname'] + pathPart + '/',
                rawpath: paths['rawpath'] + pathPart + '/',
                params: paths['params'],
                parts: paths['parts'],
            }
        }, {
            pathname: '/',
            rawpath: '/',
            params: {},
            parts: [],
        })
}

function objectToQueryString(obj) {
    const params = new URLSearchParams(obj)
    return `?${params.toString()}`
}

function queryParamsToObject(query) {
    const params = new URLSearchParams(query)
    const obj = {}
    for (const [key, value] of params) {
        obj[key] = value
    }
    return obj
}

function linkIsInternal(path) {
    return !path.includes(window.location.origin)
}

function getQueryParams(search) {
    if (search) {
        return queryParamsToObject(search)
    }
    return null
}

function dropTrailingSlash(path) {
    return path === '/' ? path : path.replace(/\/$/, '');
}
