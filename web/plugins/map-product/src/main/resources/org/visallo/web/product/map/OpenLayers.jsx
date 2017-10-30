define([
    'create-react-class',
    'prop-types',
    'openlayers',
    'fast-json-patch',
    './multiPointCluster',
    'product/toolbar/ProductToolbar'
], function(
    createReactClass,
    PropTypes,
    ol,
    jsonpatch,
    MultiPointCluster,
    ProductToolbar) {

    const noop = function() {};

    const FEATURE_HEIGHT = 40,
        FEATURE_CLUSTER_HEIGHT = 24,
        ANIMATION_DURATION = 200,
        MIN_FIT_ZOOM_RESOLUTION = 3000,
        MAX_FIT_ZOOM_RESOLUTION = 20000,
        PREVIEW_WIDTH = 300,
        PREVIEW_HEIGHT = 300,
        PREVIEW_DEBOUNCE_SECONDS = 2;

    const OpenLayers = createReactClass({
        propTypes: {
            product: PropTypes.object.isRequired,
            source: PropTypes.string.isRequired,
            sourceOptions: PropTypes.object,
            generatePreview: PropTypes.bool,
            onSelectElements: PropTypes.func.isRequired,
            onUpdatePreview: PropTypes.func.isRequired,
            onTap: PropTypes.func,
            onContextTap: PropTypes.func,
            onZoom: PropTypes.func,
            onPan: PropTypes.func,
            onMouseOver: PropTypes.func,
            onMouseOut: PropTypes.func
        },

        getInitialState() {
            return { panning: false }
        },

        getDefaultProps() {
            return {
                generatePreview: false,
                onTap: noop,
                onContextTap: noop,
                onZoom: noop,
                onPan: noop
            }
        },

        componentDidUpdate() {
            const { cluster, below, above } = this.state;

            let changed = false;
            let fit = [];

            if (cluster) {
                const { changed: c, fitFeatures } = this._syncLayer(this.props.features, cluster);
                changed = changed || c;
                if (fitFeatures) fit.push(...fitFeatures)
            }
            if (below) {
                const { changed: c, fitFeatures } = this._syncLayer(this.props.below, below);
                changed = changed || c;
                if (fitFeatures) fit.push(...fitFeatures)
            }
            if (above) {
                const { changed: c, fitFeatures } = this._syncLayer(this.props.above, above);
                changed = changed || c;
                if (fitFeatures) fit.push(...fitFeatures)
            }
            if (fit.length) {
                this.fit({ limitToFeatures: fit });
            }

            if (this.props.viewport && !_.isEmpty(this.props.viewport)) {
                this.state.map.getView().setCenter(this.props.viewport.pan);
                this.state.map.getView().setResolution(this.props.viewport.zoom);
            }

            if (this.props.generatePreview) {
                this._updatePreview({ fit: !this.props.viewport });
            } else if (changed) {
                this.updatePreview();
            }
        },

        _syncLayer(features, { source }) {
            const existingFeatures = _.indexBy(source.getFeatures(), f => f.getId());
            const newFeatures = [];
            var changed = false;

            if (features) {
                for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
                    const data = features[featureIndex];
                    const { id, styles, geometry: geometryFn, geoLocations, element, ...rest } = data;
                    let geometry = null;

                    if (geometryFn) {
                        geometry = geometryFn(ol);
                    } else if (geoLocations) {
                        geometry = new ol.geom.MultiPoint(geoLocations.map(geo => ol.proj.fromLonLat(geo)))
                    }

                    if (geometry) {
                        let featureValues = {
                            ...rest,
                            element,
                            geoLocations,
                            geometry
                        };

                        if (styles) {
                            const { normal, selected } = styles;
                            if (normal && normal.length) {
                                const radius = getRadiusFromStyles(normal);
                                featureValues._nodeRadius = radius
                                if (selected.length === 0) {
                                    const newSelected = normal[0].clone();
                                    const unselectedStroke = normal[0].getImage().getStroke();
                                    const newStroke = new ol.style.Stroke({
                                        color: '#0088cc',
                                        width: unselectedStroke && unselectedStroke.getWidth() || 1
                                    })
                                    newSelected.image_ = normal[0].getImage().clone({
                                        stroke: newStroke,
                                        opacity: 1
                                    });

                                    featureValues.styles = {
                                        normal,
                                        selected: [newSelected]
                                    }
                                } else {
                                    featureValues.styles = styles;
                                }
                            }
                        }

                        if (id in existingFeatures) {
                            const existingFeature = existingFeatures[id];
                            const existingValues = _.omit(existingFeature.getProperties(), 'geometry', 'element')
                            const newValues = _.omit(featureValues, 'geometry', 'element')
                            if (!_.isEqual(existingValues, newValues)) {
                                changed = true
                                existingFeature.setProperties(featureValues)
                            }
                            delete existingFeatures[id];
                        } else {
                            var feature = new ol.Feature(featureValues);
                            feature.setId(data.id);
                            newFeatures.push(feature);
                        }
                    }
                }
            }

            let fitFeatures;
            if (newFeatures.length) {
                changed = true
                source.addFeatures(newFeatures);
                fitFeatures = newFeatures;
            }
            if (!_.isEmpty(existingFeatures)) {
                changed = true
                _.forEach(existingFeatures, feature => source.removeFeature(feature));
            }
            return { changed, fitFeatures };
        },

        _updatePreview(options = {}) {
            const { fit = false } = options;
            const { map, baseLayerSource } = this.state;
            const doFit = () => {
                if (fit) this.fit({ animate: false });
            };

            // Since this is delayed, make sure component not unmounted
            if (!this._canvasPreviewBuffer) return;

            doFit();
            map.once('postcompose', (event) => {
                if (!this._canvasPreviewBuffer) return;
                var loading = 0, loaded = 0, events, captureTimer;

                doFit();

                const mapCanvas = event.context.canvas;
                const capture = _.debounce(() => {
                    if (!this._canvasPreviewBuffer) return;

                    doFit();

                    map.once('postrender', () => {
                        if (!this._canvasPreviewBuffer) return;
                        var newCanvas = this._canvasPreviewBuffer;
                        var context = newCanvas.getContext('2d');
                        var hRatio = PREVIEW_WIDTH / mapCanvas.width;
                        var vRatio = PREVIEW_HEIGHT / mapCanvas.height;
                        var ratio = Math.min(hRatio, vRatio);
                        newCanvas.width = Math.trunc(mapCanvas.width * ratio);
                        newCanvas.height = Math.trunc(mapCanvas.height * ratio);
                        context.drawImage(mapCanvas,
                            0, 0, mapCanvas.width, mapCanvas.height,
                            0, 0, newCanvas.width, newCanvas.height
                        );
                        if (events) {
                            events.forEach(key => ol.Observable.unByKey(key));
                        }
                        this.props.onUpdatePreview(newCanvas.toDataURL('image/png'));
                    });
                    map.renderSync();
                }, 100)

                const tileLoadStart = () => {
                    clearTimeout(captureTimer);
                    ++loading;
                };
                const tileLoadEnd = (event) => {
                    clearTimeout(captureTimer);
                    if (loading === ++loaded) {
                        captureTimer = capture();
                    }
                };

                events = [
                    baseLayerSource.on('tileloadstart', tileLoadStart),
                    baseLayerSource.on('tileloadend', tileLoadEnd),
                    baseLayerSource.on('tileloaderror', tileLoadEnd)
                ];
            });
            map.renderSync();
        },

        componentDidMount() {
            this._canvasPreviewBuffer = document.createElement('canvas');
            this._canvasPreviewBuffer.width = PREVIEW_WIDTH;
            this._canvasPreviewBuffer.height = PREVIEW_HEIGHT;

            this.olEvents = [];
            this.domEvents = [];
            this.updatePreview = _.debounce(this._updatePreview, PREVIEW_DEBOUNCE_SECONDS * 1000);
            const { map, cluster, baseLayerSource, below, above } = this.configureMap();
            this.setState({ map, cluster, baseLayerSource, below, above })
        },

        componentWillUnmount() {
            this._canvasPreviewBuffer = null;
            clearTimeout(this._handleMouseMoveTimeout);
            if (this.state.cluster) {
                this.olEvents.forEach(key => ol.Observable.unByKey(key));
                this.olEvents = null;

                this.domEvents.forEach(fn => fn());
                this.domEvents = null;
            }
        },

        render() {
            // Cover the map when panning/dragging to avoid sending events there
            const moveWrapper = this.state.panning ? (<div className="draggable-wrapper"/>) : '';
            return (
                <div style={{height: '100%'}}>
                    <div style={{height: '100%'}} ref="map"></div>
                    <ProductToolbar
                        product={this.props.product}
                        injectedProductProps={this.getInjectedToolProps()}
                        rightOffset={this.props.panelPadding.right}
                        showNavigationControls={true}
                        onFit={this.onControlsFit}
                        onZoom={this.onControlsZoom} />
                    {moveWrapper}
                </div>
            )
        },

        onControlsFit() {
            this.fit();
        },

        onControlsZoom(type) {
            const { map } = this.state;
            const view = map.getView();

            if (!this._slowZoomIn) {
                this._slowZoomIn = _.throttle(zoomByDelta(1), ANIMATION_DURATION, {trailing: false});
                this._slowZoomOut = _.throttle(zoomByDelta(-1), ANIMATION_DURATION, {trailing: false});
            }

            if (type === 'in') {
                this._slowZoomIn();
            } else {
                this._slowZoomOut();
            }

            function zoomByDelta(delta) {
                return () => {
                    var currentResolution = view.getResolution();
                    if (currentResolution) {
                        view.animate({
                            resolution: view.constrainResolution(currentResolution, delta),
                            duration: ANIMATION_DURATION
                        });
                    }
                }
            }
        },

        onControlsPan({ x, y }, { state }) {
            if (state === 'panningStart') {
                this.setState({ panning: true })
            } else if (state === 'panningEnd') {
                this.setState({ panning: false })
            } else {
                const { map } = this.state;
                const view = map.getView();

                var currentCenter = view.getCenter(),
                    resolution = view.getResolution(),
                    center = view.constrainCenter([
                        currentCenter[0] - x * resolution,
                        currentCenter[1] + y * resolution
                    ]);

                view.setCenter(center);
            }
        },

        extentFromFeatures(features) {
            const extent = ol.extent.createEmpty();
            features.forEach(feature => {
                const fExtent = feature.getGeometry().getExtent();
                if (!ol.extent.isEmpty(fExtent)) {
                    ol.extent.extend(extent, fExtent);
                }
            });
            return extent;
        },

        fit(options = {}) {
            const { animate = true, limitToFeatures = [] } = options;
            const { map, cluster } = this.state;
            const view = map.getView();
            const extent = limitToFeatures.length ?
                this.extentFromFeatures(limitToFeatures) :
                cluster.source.getExtent();
            const changeZoom = limitToFeatures.length !== 1;

            if (!ol.extent.isEmpty(extent)) {
                var resolution = view.getResolution(),
                    extentWithPadding = extent,
                    { left, right, top, bottom } = this.props.panelPadding,
                    clientBox = this.refs.map.getBoundingClientRect(),
                    padding = 20,
                    viewportWidth = clientBox.width - left - right - padding * 2,
                    viewportHeight = clientBox.height - top - bottom - padding * 2,
                    extentWithPaddingSize = ol.extent.getSize(extentWithPadding),
                    currentExtent = view.calculateExtent([viewportWidth, viewportHeight]),

                    // Figure out ideal resolution based on available realestate
                    idealResolution = Math.max(
                        extentWithPaddingSize[0] / viewportWidth,
                        extentWithPaddingSize[1] / viewportHeight
                    );


                if (limitToFeatures.length) {
                    const horizontalSync = ((left + padding) / 2 - (right + padding) / 2) * resolution;
                    const verticalSync = ((top + padding) / 2 - (bottom + padding) / 2) * resolution;
                    currentExtent[0] += horizontalSync;
                    currentExtent[1] += verticalSync;
                    currentExtent[2] += horizontalSync;
                    currentExtent[3] += verticalSync;

                    var insideCurrentView = ol.extent.containsExtent(currentExtent, extent);
                    if (insideCurrentView) {
                        return;
                    }
                }

                const newResolution = view.constrainResolution(
                    Math.min(MAX_FIT_ZOOM_RESOLUTION, Math.max(idealResolution, MIN_FIT_ZOOM_RESOLUTION)), -1
                );
                const center = ol.extent.getCenter(extentWithPadding);
                const offsetX = left - right;
                const offsetY = top - bottom;
                const lon = offsetX * view.getResolution() / 2;
                const lat = offsetY * view.getResolution() / 2;
                center[0] = center[0] - lon;
                center[1] = center[1] - lat;

                const options = { center };
                if (changeZoom) {
                    options.resolution = newResolution;
                }

                view.animate({
                    ...options,
                    duration: animate ? ANIMATION_DURATION : 0
                })
            } else {
                view.animate({
                    ...this.getDefaultViewParameters(),
                    duration: animate ? ANIMATION_DURATION : 0
                });
            }
        },

        getDefaultViewParameters() {
            return {
                zoom: 2,
                minZoom: 2,
                center: [0, 0]
            };
        },

        configureMap() {
            const { source, sourceOptions = {} } = this.props;
            const cluster = this.configureCluster()
            const { below, above } = this.configureAncillary();
            const map = new ol.Map({
                loadTilesWhileInteracting: true,
                keyboardEventTarget: document,
                controls: [],
                layers: [],
                target: this.refs.map
            });

            this.configureEvents({ map, cluster });

            var baseLayerSource;

            sourceOptions.crossOrigin = 'Anonymous';

            if (source in ol.source && _.isFunction(ol.source[source])) {
                baseLayerSource = new ol.source[source](sourceOptions)
            } else {
                console.error('Unknown map provider type: ', source);
                throw new Error('map.provider is invalid')
            }

            map.addLayer(new ol.layer.Tile({ source: baseLayerSource }));
            if (below) {
                map.addLayer(below.layer);
            }
            map.addLayer(cluster.layer)
            if (above) {
                map.addLayer(above.layer);
            }

            const view = new ol.View(this.getDefaultViewParameters());
            this.olEvents.push(view.on('change:center', (event) => this.props.onPan(event)));
            this.olEvents.push(view.on('change:resolution', (event) => this.props.onZoom(event)));

            map.setView(view);

            return { map, cluster, baseLayerSource, below, above }
        },

        configureAncillary() {
            const createLayer = type => {
                const source = new ol.source.Vector({ features: [] });
                const layer = new ol.layer.Vector({ id: `${type}Layer`, source });
                return { source, layer }
            }

            return {
                below: createLayer('below'),
                above: createLayer('above')
            };
        },

        configureCluster() {
            const source = new ol.source.Vector({ features: [] });
            const clusterSource = new MultiPointCluster({
                distance: Math.max(FEATURE_CLUSTER_HEIGHT, FEATURE_HEIGHT) / 2,
                source
            });
            const layer = new ol.layer.Vector({
                id: 'elementsLayer',
                style: cluster => this.clusterStyle(cluster),
                source: clusterSource
            });

            return { source, clusterSource, layer }
        },

        clusterStyle(cluster, options = { selected: false }) {
            const count = cluster.get('count');
            const selectionState = cluster.get('selectionState') || 'none';
            const selected = options.selected || selectionState !== 'none';

            if (count > 1) {
                return this._clusterStyle(cluster, { selected });
            } else {
                return this._featureStyle(cluster.get('features')[0], { selected })
            }
        },

        _featureStyle(feature, { selected = false } = {}) {
            const isSelected = selected || feature.get('selected');
            const extensionStyles = feature.get('styles')

            if (extensionStyles) {
                const { normal: normalStyle, selected: selectedStyle } = extensionStyles;
                let style;
                if (normalStyle.length && (!selected || !selectedStyle.length)) {
                    style = normalStyle;
                } else if (selectedStyle.length && selected) {
                    style = selectedStyle;
                }

                if (style) {
                    return style;
                }
            }
            return [new ol.style.Style({
                image: new ol.style.Icon({
                    src: feature.get(isSelected ? 'iconUrlSelected' : 'iconUrl'),
                    imgSize: feature.get('iconSize'),
                    scale: 1 / feature.get('pixelRatio'),
                    anchor: feature.get('iconAnchor')
                })
            })]
        },

        _clusterStyle(cluster, { selected = false } = {}) {
            var count = cluster.get('count'),
                selectionState = cluster.get('selectionState') || 'none',
                radius = Math.min(count || 0, FEATURE_CLUSTER_HEIGHT / 2) + 10,
                unselectedFill = 'rgba(241,59,60, 0.8)',
                unselectedStroke = '#AD2E2E',
                stroke = selected ? '#08538B' : unselectedStroke,
                strokeWidth = Math.round(radius * 0.1),
                textStroke = stroke,
                fill = selected ? 'rgba(0,112,195, 0.8)' : unselectedFill;

            if (selected && selectionState === 'some') {
                fill = unselectedFill;
                textStroke = unselectedStroke;
                strokeWidth *= 2;
            }

            return [new ol.style.Style({
                image: new ol.style.Circle({
                    radius: radius,
                    stroke: new ol.style.Stroke({
                        color: stroke,
                        width: strokeWidth
                    }),
                    fill: new ol.style.Fill({
                        color: fill
                    })
                }),
                text: new ol.style.Text({
                    text: count.toString(),
                    font: `bold condensed ${radius}px sans-serif`,
                    textAlign: 'center',
                    fill: new ol.style.Fill({
                        color: '#fff',
                    }),
                    stroke: new ol.style.Stroke({
                        color: textStroke,
                        width: 2
                    })
                })
            })];
        },

        configureEvents({ map, cluster }) {
            var self = this;

            // Feature Selection
            const selectInteraction = new ol.interaction.Select({
                condition: ol.events.condition.click,
                layers: [cluster.layer],
                style: cluster => this.clusterStyle(cluster, { selected: true })
            });

            this.olEvents.push(selectInteraction.on('select', function(e) {
                var clusters = e.target.getFeatures().getArray(),
                    elements = { vertices: [], edges: [] };

                clusters.forEach(cluster => {
                    cluster.get('features').forEach(feature => {
                        const el = feature.get('element');
                        const key = el.type === 'vertex' ? 'vertices' : 'edges';
                        elements[key].push(el.id);
                    })
                })
                self.props.onSelectElements(elements);
            }));

            this.olEvents.push(map.on('click', function(event) {
                self.props.onTap(event);
            }));
            this.olEvents.push(map.on('pointerup', function(event) {
                const { pointerEvent } = event;
                if (pointerEvent && pointerEvent.button === 2) {
                    self.props.onContextTap(event);
                }
            }));

            this.olEvents.push(cluster.clusterSource.on('change', _.debounce(function() {
                var selected = selectInteraction.getFeatures(),
                    clusters = this.getFeatures(),
                    newSelection = [],
                    isSelected = feature => feature.get('selected');

                clusters.forEach(cluster => {
                    var innerFeatures = cluster.get('features');
                    if (_.any(innerFeatures, isSelected)) {
                        newSelection.push(cluster);
                        if (_.all(innerFeatures, isSelected)) {
                            cluster.set('selectionState', 'all');
                        } else {
                            cluster.set('selectionState', 'some');
                        }
                    } else {
                        cluster.unset('selectionState');
                    }
                })

                selected.clear()
                if (newSelection.length) {
                    selected.extend(newSelection)
                }
            }, 100)));

            map.addInteraction(selectInteraction);

            const viewport = map.getViewport();
            this.domEvent(viewport, 'contextmenu', function(event) {
                event.preventDefault();
            })
            this.domEvent(viewport, 'mouseup', function(event) {
                event.preventDefault();
                if (event.button === 2 || event.ctrlKey) {
                    // TODO
                    //self.handleContextMenu(event);
                }
            });
            this.domEvent(viewport, 'mousemove', event => {
                const pixel = map.getEventPixel(event);
                const hit = map.getFeaturesAtPixel(pixel);
                if (hit) {
                    this.handleMouseMove(hit);
                    map.getTarget().style.cursor = 'pointer';
                } else {
                    this.handleMouseMove();
                    map.getTarget().style.cursor = '';
                }
            });
        },

        domEvent(el, type, handler) {
            this.domEvents.push(() => el.removeEventListener(type, handler));
            el.addEventListener(type, handler, false);
        },

        handleMouseMove(features) {
            const { onMouseOver, onMouseOut } = this.props;
            const { map } = this.state;

            if (!onMouseOver && !onMouseOut ) {
                return;
            }

            const stillHoveringSameFeature = features &&
                this._handleMouseMoveFeatures &&
                this._handleMouseMoveFeatures.length === features.length &&
                this._handleMouseMoveFeatures[0] === features[0];

            if (!stillHoveringSameFeature) {
                clearTimeout(this._handleMouseMoveTimeout);

                if (features && features.length) {
                    this._handleMouseMoveTimeout = setTimeout(() => {
                        this._handleMouseMoveFeatures = features;
                        if (onMouseOver) {
                            onMouseOver(ol, map, this._handleMouseMoveFeatures)
                        }
                    }, 250);
                } else if (this._handleMouseMoveFeatures) {
                    if (onMouseOut) {
                        onMouseOut(ol, map, this._handleMouseMoveFeatures)
                    }
                    this._handleMouseMoveFeatures = null;
                }
            }
        },

        /**
         * Map work product toolbar item component
         *
         * @typedef org.visallo.product.toolbar.item~MapComponent
         * @property {function} requestUpdate Reload the maps extensions and styles.
         * Call when the result of extensions will change from variables
         * outside of inputs (preferences, etc).
         * @property {object} product The map product
         * @property {object} ol The [Openlayers Api](http://openlayers.org/en/latest/apidoc/)
         * @property {object} map [map](http://openlayers.org/en/latest/apidoc/ol.Map.html) instance
         * @property {object} cluster
         * @property {object} cluster.clusterSource [multiPointCluster](https://github.com/visallo/visallo/blob/master/web/plugins/map-product/src/main/resources/org/visallo/web/product/map/multiPointCluster.js) that implements the [`ol.source.Cluster`](http://openlayers.org/en/latest/apidoc/ol.source.Cluster.html) interface to cluster the `source` features.
         * @property {object} cluster.source The [`ol.source.Vector`](http://openlayers.org/en/latest/apidoc/ol.source.Vector.html) source of all map pins before clustering.
         * @property {object} cluster.layer The [`ol.layer.Vector`](http://openlayers.org/en/latest/apidoc/ol.layer.Vector.html) pin layer
         */
        getInjectedToolProps() {
            const { clearCaches: requestUpdate, product } = this.props;
            const { map, cluster } = this.state;
            let props = {};

            if (map && cluster) {
                props = { product, ol, map, cluster, requestUpdate }
            }

            return props;
        }
    })

    return OpenLayers;

    function getRadiusFromStyles(styles) {
        for (let i = styles.length - 1; i >= 0; i--) {
            const image = styles[i].getImage();
            const radius = image && image.getRadius();
            if (radius) {
                const nodeRadius = radius / devicePixelRatio
                return nodeRadius;
            }
        }
    }
})

