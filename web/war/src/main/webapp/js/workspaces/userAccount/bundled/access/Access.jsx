define([
    'create-react-class',
    'util/formatters'
], function (createReactClass, F) {
    'use strict';

    const order = 'EDIT COMMENT PUBLISH ADMIN'.split(' ');

    return createReactClass({
        render() {
            const user = visalloData.currentUser;
            const privileges = _.chain(user.privileges)
                .without('READ')
                .sortBy(function (p) {
                    return order.indexOf(p);
                })
                .value();
            const authorizations = user.authorizations || [];

            return (<div>
                <h1>{i18n('useraccount.page.access.previousLogin')}</h1>
                <p>
                    {user.previousLoginDate ? F.date.dateTimeString(user.previousLoginDate) : i18n('useraccount.page.access.firstLogin')}
                </p>

                <h1>{i18n('useraccount.page.access.privileges')}</h1>
                <p>
                    {privileges.length > 0 ? privileges.join(', ') : (<i>READ</i>)}
                </p>

                <h1>{i18n('useraccount.page.access.authorizations')}</h1>
                <p>
                    {authorizations.length > 0 ? authorizations.join(', ') : (<i>none</i>)}
                </p>
            </div>);
        }
    })
});
