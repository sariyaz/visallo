define([
    'create-react-class',
    'prop-types',
    'react-redux',
    './BaseSelect',
    'data/web-worker/store/user/selectors',
    'data/web-worker/store/ontology/selectors',
    'data/web-worker/store/ontology/actions'
], function(
    createReactClass,
    PropTypes,
    redux,
    BaseSelect,
    userSelectors,
    ontologySelectors,
    ontologyActions) {

    const FilterProps = ['dataType', 'deleteable', 'searchable', 'sortable', 'updateable', 'userVisible', 'addable'];
    const FilterPropDefaults = {
        userVisible: true
    };

    const PropertySelector = createReactClass({
        propTypes: {
            filter: PropTypes.shape({
                conceptId: PropTypes.string,
                relationshipId: PropTypes.string,
                hideCompound: PropTypes.bool,
                addable: PropTypes.bool,
                userVisible: PropTypes.bool,
                searchable: PropTypes.bool,
                deleteable: PropTypes.bool,
                sortable: PropTypes.bool,
                updateable: PropTypes.bool,
                dataType: PropTypes.string,
                dataTypes: PropTypes.array
            }),
            value: PropTypes.string,
            properties: PropTypes.array.isRequired,
            propertiesByConcept: PropTypes.object.isRequired,
            propertiesByRelationship: PropTypes.object.isRequired,
            privileges: PropTypes.object.isRequired,
            placeholder: PropTypes.string
        },
        getDefaultProps() {
            return { creatable: true, placeholder: i18n('property.field.placeholder') }
        },
        render() {
            const {
                properties,
                propertiesByConcept,
                propertiesByRelationship,
                filter,
                privileges, creatable, ...rest } = this.props;
            const formProps = { ...(filter || {}) };
            const dependentPropertyIris = [];
            let options = properties.filter((p, i, list) => {
                if (p.header) {
                    return true;
                }

                let test = true;
                if (filter && filter.properties) {
                    test = test && p.title in filter.properties;
                }
                if (test && filter && _.isArray(filter.dataTypes) && filter.dataTypes.length) {
                    test = test && filter.dataTypes.includes(p.dataType)
                }
                if (test && filter && filter.conceptId) {
                    const conceptProps = propertiesByConcept[filter.conceptId];
                    const conceptProp = conceptProps && conceptProps[p.title];
                    formProps.domain = filter.conceptId;
                    test = test && Boolean(conceptProp);
                }
                if (test && filter && filter.relationshipId) {
                    const relationshipProps = propertiesByRelationship[filter.relationshipId];
                    const relationshipProp = relationshipProps && relationshipProps[p.title];
                    formProps.domain = filter.relationshipId;
                    test = test && Boolean(relationshipProp);
                }
                if (test && filter && filter.hideCompound) {
                    test = test && !p.dependentPropertyIris;
                }
                if (test && filter && filter.rollupCompound && p.dependentPropertyIris) {
                    dependentPropertyIris.push(...p.dependentPropertyIris);
                }
                if (test) {
                    FilterProps.forEach(fp => {
                        if (filter && fp in filter) {
                            // otherwise any value is valid
                            if (filter[fp] !== undefined && filter[fp] !== null) {
                                test = test && p[fp] === filter[fp];
                            }
                        }
                    })
                }
                return test;
            });

            if (filter && filter.rollupCompound) {
                const uniqueIris = _.object(dependentPropertyIris.map(iri => [iri, true]))
                options = options.filter(o => !uniqueIris[o.title]);
            }

            removeEmptyHeaders(options)

            let usesLegacyFilterProperties = false;
            if (creatable && filter && filter.properties) {
                console.warn('Creating properties when using old filter syntax (passing properties) is not supported');
                usesLegacyFilterProperties = true;
            }

            return (
                <BaseSelect
                    createForm={'components/ontology/PropertyForm'}
                    formProps={formProps}
                    options={options}
                    creatable={creatable && !usesLegacyFilterProperties && Boolean(privileges.ONTOLOGY_ADD)}
                    {...rest} />
            );
        }
    });

    return redux.connect(
        (state, props) => {
            var otherFilters = props.filter,
                properties = ontologySelectors.getVisiblePropertiesWithHeaders(state);
            if (otherFilters) {
                const { userVisible, ...rest } = otherFilters;
                otherFilters = rest;
                const showAdmin = userVisible === null;
                if (showAdmin) {
                    properties = ontologySelectors.getPropertiesWithHeaders(state);
                }
            }
            return {
                privileges: userSelectors.getPrivileges(state),
                properties,
                propertiesByConcept: ontologySelectors.getPropertiesByConcept(state),
                propertiesByRelationship: ontologySelectors.getPropertiesByRelationship(state),
                iriKeys: ontologySelectors.getPropertyKeyIris(state),
                ...props
            };
        },

        (dispatch, props) => ({
            onCreate: ({ displayName, dataType, displayType, domain }, options) => {
                let property = {
                    displayName,
                    dataType,
                    displayType,
                    ...domain,
                };
                if (!property.displayType) {
                    delete property.displayType;
                }
                dispatch(ontologyActions.addProperty(property, options));
            }
        })
    )(PropertySelector);

    function removeEmptyHeaders(options) {
        const removeHeaderIndices = [];
        let lastHeaderIndex = -1;
        options.forEach((o, i, list) => {
            if (o.header) {
                if (lastHeaderIndex === (i - 1)) {
                    removeHeaderIndices.push(lastHeaderIndex)
                }
                if (i === (list.length - 1)) {
                    removeHeaderIndices.push(i)
                }
                lastHeaderIndex = i;
            }
        })
        removeHeaderIndices.reverse().forEach(i => {
            options.splice(i, 1);
        })
    }
});
