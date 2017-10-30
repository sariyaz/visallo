package org.visallo.web.routes.user;

import com.google.inject.Inject;
import com.google.inject.Singleton;
import com.v5analytics.webster.ParameterizedHandler;
import com.v5analytics.webster.annotations.Handle;
import org.visallo.core.model.user.UserSessionCounterRepository;
import org.visallo.core.security.AuditService;
import org.visallo.web.CurrentUser;
import org.visallo.web.VisalloResponse;
import org.visallo.web.clientapi.model.ClientApiSuccess;

import javax.servlet.http.HttpServletRequest;

@Singleton
public class Logout implements ParameterizedHandler {
    private UserSessionCounterRepository userSessionCounterRepository;
    private final AuditService auditService;

    @Inject
    public Logout(
            UserSessionCounterRepository userSessionCounterRepository,
            AuditService auditService
    ) {
        this.userSessionCounterRepository = userSessionCounterRepository;
        this.auditService = auditService;
    }

    @Handle
    public ClientApiSuccess handle(HttpServletRequest request) throws Exception {
        String userId = CurrentUser.getUserId(request);
        String sessionId = request.getSession().getId();
        this.userSessionCounterRepository.deleteSession(userId, sessionId);
        CurrentUser.clearUserFromSession(request);
        auditService.auditLogout(userId);
        request.getSession().invalidate();
        return VisalloResponse.SUCCESS;
    }
}
