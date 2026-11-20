package com.pif.api.echo;

import com.pif.api.security.AuthUser;
import com.pif.api.web.JsonBodyCache;
import com.pif.api.web.RouteAnnotations.Roles;
import com.pif.api.web.RouteAnnotations.Throttle;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/**
 * ÉCHO — assistant financier contextuel. INVESTOR only; every route works on the caller's own data.
 * No route places, modifies or cancels an order.
 */
@RestController
@RequestMapping("/echo")
@Roles("INVESTOR")
@Throttle(limit = 60, ttlSeconds = 60)
@Tag(name = "ÉCHO")
public class EchoController {

  private final EchoConversationService conversations;
  private final EchoMemoryService memory;
  private final EchoAlertService alerts;
  private final ObjectMapper mapper;

  public EchoController(EchoConversationService conversations, EchoMemoryService memory, EchoAlertService alerts,
      ObjectMapper mapper) {
    this.conversations = conversations;
    this.memory = memory;
    this.alerts = alerts;
    this.mapper = mapper;
  }

  @GetMapping("/capabilities")
  @Operation(summary = "Capacités réelles d'ÉCHO")
  public Map<String, Object> capabilities(HttpServletRequest req) {
    AuthUser.from(req);
    return Map.of(
        "engine", EchoAnswer.ENGINE,
        "languageModel", Map.of("available", false, "reason",
            "Aucun modèle conversationnel n'est installé ; ÉCHO combine un routeur d'intentions français déterministe "
                + "et les moteurs de calcul existants."),
        "tools", EchoFinancialTools.ALLOWLIST,
        "intents", List.of(EchoIntentRouter.Intent.values()),
        "alertRules", EchoAlertService.rules(),
        "autonomousOrders", false);
  }

  @PostMapping("/ask")
  @Throttle(limit = 30, ttlSeconds = 60)
  @Operation(summary = "Poser une question à ÉCHO")
  public Map<String, Object> ask(HttpServletRequest req) {
    return conversations.ask(AuthUser.from(req), JsonBodyCache.get(req, mapper));
  }

  @PostMapping("/pretrade")
  @Throttle(limit = 30, ttlSeconds = 60)
  @Operation(summary = "Contrôle de risque d'un ordre en préparation (aucun ordre envoyé)")
  public Map<String, Object> preTrade(HttpServletRequest req) {
    return conversations.preTrade(AuthUser.from(req), JsonBodyCache.get(req, mapper));
  }

  @GetMapping("/conversations")
  public Map<String, Object> conversations(HttpServletRequest req) {
    return conversations.conversations(AuthUser.from(req));
  }

  @GetMapping("/conversations/{id}")
  public Map<String, Object> conversation(HttpServletRequest req, @PathVariable("id") String id) {
    return conversations.conversation(AuthUser.from(req), EchoMemoryService.parseUuid(id));
  }

  @DeleteMapping("/conversations/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteConversation(HttpServletRequest req, @PathVariable("id") String id) {
    conversations.deleteConversation(AuthUser.from(req), EchoMemoryService.parseUuid(id));
  }

  @DeleteMapping("/conversations")
  public Map<String, Object> deleteConversations(HttpServletRequest req) {
    return conversations.deleteAll(AuthUser.from(req));
  }

  @GetMapping("/preferences")
  public Map<String, Object> preferences(HttpServletRequest req) {
    return memory.preferences(AuthUser.from(req));
  }

  @PutMapping("/preferences")
  public Map<String, Object> savePreferences(HttpServletRequest req) {
    return memory.savePreferences(AuthUser.from(req), JsonBodyCache.get(req, mapper));
  }

  @GetMapping("/decisions")
  public Map<String, Object> decisions(HttpServletRequest req) {
    return memory.decisions(AuthUser.from(req));
  }

  @PostMapping("/decisions")
  @ResponseStatus(HttpStatus.CREATED)
  @Operation(summary = "Enregistrer une intention (mémoire activée uniquement)")
  public Map<String, Object> createDecision(HttpServletRequest req) {
    return memory.create(AuthUser.from(req), JsonBodyCache.get(req, mapper));
  }

  @GetMapping("/decisions/{id}")
  public Map<String, Object> decision(HttpServletRequest req, @PathVariable("id") String id) {
    return memory.decision(AuthUser.from(req), EchoMemoryService.parseUuid(id));
  }

  @PatchMapping("/decisions/{id}")
  public Map<String, Object> updateDecision(HttpServletRequest req, @PathVariable("id") String id) {
    return memory.update(AuthUser.from(req), EchoMemoryService.parseUuid(id), JsonBodyCache.get(req, mapper));
  }

  @PostMapping("/decisions/{id}/review")
  @Operation(summary = "Confronter l'intention au résultat mesuré")
  public Map<String, Object> review(HttpServletRequest req, @PathVariable("id") String id) {
    return memory.review(AuthUser.from(req), EchoMemoryService.parseUuid(id));
  }

  @DeleteMapping("/decisions/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteDecision(HttpServletRequest req, @PathVariable("id") String id) {
    memory.delete(AuthUser.from(req), EchoMemoryService.parseUuid(id));
  }

  @DeleteMapping("/decisions")
  public Map<String, Object> deleteDecisions(HttpServletRequest req) {
    return memory.deleteAll(AuthUser.from(req));
  }

  @GetMapping("/alerts")
  @Operation(summary = "Évaluer et lister les alertes actives (dédupliquées)")
  public Map<String, Object> alerts(HttpServletRequest req,
      @RequestParam(name = "force", required = false, defaultValue = "false") boolean force) {
    return alerts.poll(AuthUser.from(req), force);
  }

  @GetMapping("/alerts/history")
  public Map<String, Object> alertHistory(HttpServletRequest req) {
    return alerts.history(AuthUser.from(req));
  }

  @PostMapping("/alerts/{id}/read")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void read(HttpServletRequest req, @PathVariable("id") String id) {
    alerts.markRead(AuthUser.from(req), EchoMemoryService.parseUuid(id));
  }

  @PostMapping("/alerts/{id}/dismiss")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void dismiss(HttpServletRequest req, @PathVariable("id") String id) {
    alerts.dismiss(AuthUser.from(req), EchoMemoryService.parseUuid(id));
  }
}
