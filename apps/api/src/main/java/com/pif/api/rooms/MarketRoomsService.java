package com.pif.api.rooms;

import com.pif.api.data.Db;
import com.pif.api.finance.Money;
import com.pif.api.market.MarketDataWarehouseRepository;
import com.pif.api.rooms.MarketRoomsRepository.MemberRow;
import com.pif.api.rooms.MarketRoomsRepository.RoomRow;
import com.pif.api.rooms.RoomEconomy.Rules;
import com.pif.api.rooms.RoomValuation.Snapshot;
import com.pif.api.security.AuthUser;
import com.pif.api.trading.PortfoliosService;
import com.pif.api.trading.TradingDtos;
import com.pif.api.trading.TradingRepository;
import com.pif.api.trading.TradingRules;
import com.pif.api.web.ApiException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException; // used by insertReward paths / clarity
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class MarketRoomsService {

  private static final String CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  private static final SecureRandom RNG = new SecureRandom();
  private final MarketRoomsRepository rooms;
  private final TradingRepository trading;
  private final PortfoliosService portfolios;
  private final MarketDataWarehouseRepository warehouse;
  private final RoomValuation valuation;
  private final RoomEventHub hub;
  private final JdbcClient jdbc;
  private final Clock clock;
  private final TransactionTemplate tx;

  public MarketRoomsService(MarketRoomsRepository rooms, TradingRepository trading, PortfoliosService portfolios,
      MarketDataWarehouseRepository warehouse, RoomValuation valuation, RoomEventHub hub, JdbcClient jdbc,
      Clock clock, PlatformTransactionManager txManager) {
    this.rooms = rooms;
    this.trading = trading;
    this.portfolios = portfolios;
    this.warehouse = warehouse;
    this.valuation = valuation;
    this.hub = hub;
    this.jdbc = jdbc;
    this.clock = clock;
    this.tx = new TransactionTemplate(txManager);
    this.tx.setTimeout(30);
  }

  public boolean available() {
    return rooms.tablesPresent();
  }

  public Map<String, Object> catalog(AuthUser user) {
    assertAvailable();
    List<Map<String, Object>> list = new ArrayList<>();
    for (RoomRow r : rooms.listVisible(user.id())) {
      list.add(roomSummary(r));
    }
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("rooms", list);
    m.put("onboarding", onboardingCopy());
    m.put("disclaimer",
        "Simulation pédagogique uniquement — aucun argent réel, aucun produit financier réel.");
    return m;
  }

  public Map<String, Object> create(AuthUser user, Map<String, Object> body) {
    assertAvailable();
    String title = text(body.get("title"), "Salle de marché");
    if (title.length() < 3 || title.length() > 80) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Titre de salle invalide (3–80 caractères).");
    }
    String description = text(body.get("description"), "Simulation collaborative fictive.");
    String visibility = text(body.get("visibility"), "PUBLIC").toUpperCase(Locale.ROOT);
    String mode = text(body.get("mode"), "LEARNING").toUpperCase(Locale.ROOT);
    if (!List.of("PUBLIC", "PRIVATE").contains(visibility)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Visibilité invalide.");
    }
    if (!List.of("LEARNING", "COMPETITION", "CLASSROOM", "PRACTICE").contains(mode)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Mode de salle invalide.");
    }
    @SuppressWarnings("unchecked")
    Map<String, Object> rulesRaw = body.get("rules") instanceof Map<?, ?> map
        ? (Map<String, Object>) map : Map.of();
    Rules rules = Rules.fromJson(rulesRaw);
    String marketScope = rules.marketScope() == null ? "FICTIONAL" : rules.marketScope().toUpperCase(Locale.ROOT);
    final LocalDate simClock;
    if (rules.simStartDate() != null && !rules.simStartDate().isBlank()) {
      simClock = LocalDate.parse(rules.simStartDate());
    } else if (rules.crisisEpisodeId() != null && warehouse.tablesPresent()) {
      simClock = crisisStart(rules.crisisEpisodeId());
    } else {
      simClock = null;
    }
    Instant now = now();
    Instant inviteExpires = "PRIVATE".equals(visibility) ? now.plus(Duration.ofDays(7)) : null;
    UUID roomId = Db.newId();
    String code = uniqueCode();
    String display = displayName(user);
    final Rules rulesFinal = rules;

    RoomRow room = tx.execute(status -> {
      try {
        RoomRow created = rooms.insertRoom(roomId, code, title, description, visibility, mode, user.id(),
            writeJson(rulesFinal.toJson()), marketScope, rulesFinal.crisisEpisodeId(), simClock, rulesFinal.maxParticipants(),
            inviteExpires, now);
        UUID portfolioId = createRoomPortfolio(user.id(), code, rulesFinal.initialCapitalMillimes(), now);
        rooms.insertMember(Db.newId(), roomId, user.id(),
            "CLASSROOM".equals(mode) ? "HOST" : "HOST", display, portfolioId, now);
        emit(roomId, "ROOM_CREATED", user.id(), Map.of("code", code, "title", title), now);
        return created;
      } catch (DuplicateKeyException e) {
        throw new ApiException(HttpStatus.CONFLICT, "ROOM_CODE_COLLISION", "Réessayez la création de salle.");
      }
    });
    return detail(user, room.id());
  }

  public Map<String, Object> join(AuthUser user, Map<String, Object> body) {
    assertAvailable();
    String code = text(body.get("code"), "").trim().toUpperCase(Locale.ROOT);
    UUID roomId = body.get("roomId") != null ? UUID.fromString(String.valueOf(body.get("roomId"))) : null;
    RoomRow room = roomId != null ? rooms.room(roomId).orElse(null) : rooms.roomByCode(code).orElse(null);
    if (room == null) {
      throw new ApiException(HttpStatus.NOT_FOUND, "ROOM_NOT_FOUND", "Salle introuvable.");
    }
    if ("ENDED".equals(room.status())) {
      throw new ApiException(HttpStatus.CONFLICT, "ROOM_ENDED", "Cette salle est terminée.");
    }
    if ("PRIVATE".equals(room.visibility())) {
      if (code.isBlank() || !code.equalsIgnoreCase(room.code())) {
        throw new ApiException(HttpStatus.FORBIDDEN, "INVITE_REQUIRED",
            "Cette salle est privée. Utilisez le code d'invitation.");
      }
      if (room.inviteExpiresAt() != null && now().isAfter(room.inviteExpiresAt())) {
        throw new ApiException(HttpStatus.GONE, "INVITE_EXPIRED", "Le code d'invitation a expiré.");
      }
    }
    if (rooms.activeMember(room.id(), user.id()).isPresent()) {
      return detail(user, room.id());
    }
    if (rooms.activeMemberCount(room.id()) >= room.maxParticipants()) {
      throw new ApiException(HttpStatus.CONFLICT, "ROOM_FULL", "La salle a atteint sa capacité maximale.");
    }
    Rules rules = rulesOf(room);
    Instant now = now();
    tx.executeWithoutResult(status -> {
      UUID portfolioId = createRoomPortfolio(user.id(), room.code(), rules.initialCapitalMillimes(), now);
      String role = "SPECTATOR".equalsIgnoreCase(text(body.get("role"), "PLAYER")) ? "SPECTATOR" : "PLAYER";
      rooms.insertMember(Db.newId(), room.id(), user.id(), role, displayName(user),
          "SPECTATOR".equals(role) ? null : portfolioId, now);
      emit(room.id(), "MEMBER_JOINED", user.id(), Map.of("displayName", displayName(user), "role", role), now);
    });
    return detail(user, room.id());
  }

  public Map<String, Object> leave(AuthUser user, UUID roomId) {
    MemberRow member = requireMember(roomId, user.id());
    Instant now = now();
    rooms.leaveMember(member.id(), now);
    emit(roomId, "MEMBER_LEFT", user.id(), Map.of("displayName", member.displayName()), now);
    return Map.of("ok", true, "roomId", roomId.toString());
  }

  public Map<String, Object> detail(AuthUser user, UUID roomId) {
    assertAvailable();
    RoomRow room = requireRoom(roomId);
    MemberRow me = rooms.activeMember(roomId, user.id()).orElse(null);
    if (me == null && "PRIVATE".equals(room.visibility()) && !room.hostUserId().equals(user.id())) {
      throw new ApiException(HttpStatus.FORBIDDEN, "NOT_A_MEMBER", "Vous n'êtes pas membre de cette salle privée.");
    }
    return roomDetail(room, me, user);
  }

  public Map<String, Object> start(AuthUser user, UUID roomId) {
    RoomRow room = requireHostOrFacilitator(roomId, user);
    if (!"LOBBY".equals(room.status()) && !"PAUSED".equals(room.status())) {
      throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "La salle ne peut pas démarrer dans cet état.");
    }
    Instant now = now();
    rooms.setActive(roomId, now, now);
    emit(roomId, "ROOM_STARTED", user.id(), Map.of("status", "ACTIVE"), now);
    return detail(user, roomId);
  }

  public Map<String, Object> pause(AuthUser user, UUID roomId) {
    requireHostOrFacilitator(roomId, user);
    Instant now = now();
    rooms.setPaused(roomId, now, now);
    emit(roomId, "ROOM_PAUSED", user.id(), Map.of("status", "PAUSED"), now);
    return detail(user, roomId);
  }

  public Map<String, Object> end(AuthUser user, UUID roomId) {
    RoomRow room = requireHostOrFacilitator(roomId, user);
    Instant now = now();
    List<Map<String, Object>> finalBoard = leaderboard(room);
    rooms.endRoom(roomId, now);
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("status", "ENDED");
    payload.put("finalLeaderboard", finalBoard);
    payload.put("scoreExplanation", RoomEconomy.scoreExplanation());
    emit(roomId, "ROOM_ENDED", user.id(), payload, now);
    return detail(user, roomId);
  }

  public Map<String, Object> advanceClock(AuthUser user, UUID roomId) {
    RoomRow room = requireHostOrFacilitator(roomId, user);
    if (!"ACTIVE".equals(room.status())) {
      throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "Horloge avancée uniquement en session active.");
    }
    if ("FICTIONAL".equals(room.marketScope())) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "NO_HISTORICAL_CLOCK",
          "Cette salle utilise le simulateur fictif (pas d'horloge historique).");
    }
    Rules rules = rulesOf(room);
    LocalDate current = room.simClockDate() == null ? LocalDate.now(clock) : room.simClockDate();
    LocalDate next = current.plusDays(1);
    if (rules.simEndDate() != null && next.isAfter(LocalDate.parse(rules.simEndDate()))) {
      throw new ApiException(HttpStatus.CONFLICT, "SIM_END_REACHED",
          "La période historique de la salle est terminée.");
    }
    Instant now = now();
    rooms.advanceClock(roomId, next, now);
    emit(roomId, "CLOCK_ADVANCED", user.id(), Map.of(
        "simClockDate", next.toString(),
        "label", "Simulation sur données historiques"), now);
    return detail(user, roomId);
  }

  public Map<String, Object> state(AuthUser user, UUID roomId, long sinceSeq) {
    requireMemberOrPublic(roomId, user);
    RoomRow room = requireRoom(roomId);
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("roomId", roomId.toString());
    m.put("status", room.status());
    m.put("eventSeq", room.eventSeq());
    m.put("simClockDate", room.simClockDate() == null ? null : room.simClockDate().toString());
    m.put("events", rooms.eventsSince(roomId, sinceSeq));
    m.put("members", rooms.activeMembers(roomId).stream().map(this::memberPublic).toList());
    m.put("leaderboard", leaderboard(room));
    return m;
  }

  public Map<String, Object> awardLearning(AuthUser user, UUID roomId, Map<String, Object> body) {
    MemberRow member = requireMember(roomId, user.id());
    RoomRow room = requireRoom(roomId);
    if ("ENDED".equals(room.status())) {
      throw new ApiException(HttpStatus.CONFLICT, "ROOM_ENDED", "Salle terminée.");
    }
    String sourceKind = text(body.get("sourceKind"), "").toUpperCase(Locale.ROOT);
    String sourceRef = text(body.get("sourceRef"), "").trim();
    if (!List.of("MISSION", "QUIZ", "CHALLENGE", "RISK_PRACTICE", "TUTORIAL").contains(sourceKind)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Type de récompense invalide.");
    }
    if (sourceRef.length() < 2 || sourceRef.length() > 100) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Référence de progression invalide.");
    }
    int points = switch (sourceKind) {
      case "MISSION" -> 40;
      case "QUIZ" -> 25;
      case "CHALLENGE" -> 35;
      case "RISK_PRACTICE" -> 30;
      default -> 15;
    };
    // Verify mission completion when possible (no fake mastery).
    if ("MISSION".equals(sourceKind) && !missionCompleted(user.id(), sourceRef)) {
      throw new ApiException(HttpStatus.CONFLICT, "PROGRESS_NOT_VERIFIED",
          "Terminez réellement la mission ou l'évaluation avant de réclamer les points.");
    }
    Instant now = now();
    Boolean awarded = tx.execute(status -> {
      if (!rooms.insertReward(roomId, member.id(), sourceKind, sourceRef, points)) {
        return false;
      }
      int newPoints = member.learningPoints() + points;
      String level = RoomEconomy.levelFromPoints(newPoints);
      boolean unlock = member.tradingLocked() && newPoints >= rulesOf(room).minLearningPointsForCredit();
      rooms.updateEconomy(member.id(), newPoints, member.creditDebtMillimes(), member.creditDrawnMillimes(),
          member.convertedCapitalMillimes(), unlock ? false : member.tradingLocked(),
          unlock ? null : member.lockReason(), level, member.lastConversionAt());
      rooms.insertLedger(roomId, member.id(), "LEARNING_REWARD", 0, points, null, null, newPoints,
          "reward:" + sourceKind + ":" + sourceRef, "Points pédagogiques", now);
      return true;
    });
    if (Boolean.FALSE.equals(awarded)) {
      throw new ApiException(HttpStatus.CONFLICT, "REWARD_ALREADY_CLAIMED",
          "Cette récompense a déjà été obtenue dans cette salle.");
    }
    emit(roomId, "POINTS_AWARDED", user.id(), Map.of("points", points, "sourceKind", sourceKind), now);
    return detail(user, roomId);
  }

  public Map<String, Object> convertPoints(AuthUser user, UUID roomId, Map<String, Object> body) {
    MemberRow member = requireMember(roomId, user.id());
    RoomRow room = requireRoom(roomId);
    requireRoomOpen(room);
    if (member.portfolioId() == null) {
      throw new ApiException(HttpStatus.FORBIDDEN, "SPECTATOR_ONLY", "Les spectateurs ne convertissent pas de points.");
    }
    Rules rules = rulesOf(room);
    int points = (int) Math.floor(num(body.get("points"), 0));
    String idem = text(body.get("idempotencyKey"), "").trim();
    if (idem.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "idempotencyKey requis.");
    }
    var existing = rooms.ledgerByIdempotency(roomId, idem);
    if (existing.isPresent()) {
      return Map.of("idempotentReplay", true, "ledger", existing.get(), "room", detail(user, roomId));
    }
    if (points <= 0 || points > member.learningPoints()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INSUFFICIENT_POINTS",
          "Points insuffisants pour cette conversion.");
    }
    if (member.lastConversionAt() != null
        && Duration.between(member.lastConversionAt(), now()).toHours() < rules.conversionCooldownHours()) {
      throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "CONVERSION_COOLDOWN",
          "Patientez avant une nouvelle conversion de points (anti-exploitation).");
    }
    long capital = RoomEconomy.conversionCapitalMillimes(rules, points);
    if (capital <= 0) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "CONVERSION_TOO_SMALL", "Montant converti trop faible.");
    }
    if (member.convertedCapitalMillimes() + capital > rules.maxConversionMillimes()) {
      throw new ApiException(HttpStatus.CONFLICT, "CONVERSION_CAP",
          "Plafond de conversion de la salle atteint.");
    }
    Instant now = now();
    try {
      tx.executeWithoutResult(status -> {
        MemberRow fresh = rooms.activeMember(roomId, user.id()).orElseThrow();
        int remainingPoints = fresh.learningPoints() - points;
        long converted = fresh.convertedCapitalMillimes() + capital;
        portfolios.cashFlow(user, fresh.portfolioId(),
            new TradingDtos.CashFlow("DEPOSIT", Money.fromAmount(capital), portfolioVersion(fresh.portfolioId())));
        rooms.updateEconomy(fresh.id(), remainingPoints, fresh.creditDebtMillimes(), fresh.creditDrawnMillimes(),
            converted, false, null, RoomEconomy.levelFromPoints(remainingPoints), now);
        rooms.insertLedger(roomId, fresh.id(), "POINT_CONVERSION", capital, -points,
            null, null, remainingPoints, idem,
            "Conversion points → capital fictif (taux " + rules.pointsToCapitalRate() + " pts / unité)", now);
      });
    } catch (DataIntegrityViolationException dup) {
      var replayed = rooms.ledgerByIdempotency(roomId, idem);
      if (replayed.isPresent()) {
        return Map.of("idempotentReplay", true, "ledger", replayed.get(), "room", detail(user, roomId));
      }
      throw dup;
    }
    emit(roomId, "POINTS_CONVERTED", user.id(), Map.of(
        "points", points, "capital", Money.fromAmount(capital)), now);
    return detail(user, roomId);
  }

  public Map<String, Object> creditPreview(AuthUser user, UUID roomId) {
    MemberRow member = requireMember(roomId, user.id());
    RoomRow room = requireRoom(roomId);
    Rules rules = rulesOf(room);
    // creditCeilingMillimes already nets lifetime draws — do not subtract outstanding debt again.
    long available = RoomEconomy.creditCeilingMillimes(rules, member.learningPoints(), member.creditDrawnMillimes());
    long maxOutstanding = (long) Math.round(rules.initialCapitalMillimes() * (rules.maxCreditOutstandingPct() / 100.0));
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("availableCredit", Money.fromAmount(available));
    m.put("ceiling", Money.fromAmount(available + member.creditDrawnMillimes()));
    m.put("maxOutstanding", Money.fromAmount(maxOutstanding));
    m.put("currentDebt", Money.fromAmount(member.creditDebtMillimes()));
    m.put("drawnLifetime", Money.fromAmount(member.creditDrawnMillimes()));
    m.put("minLearningPoints", rules.minLearningPointsForCredit());
    m.put("learningPoints", member.learningPoints());
    m.put("eligible", available > 0 && !member.tradingLocked());
    m.put("disclaimer", "Crédit entièrement fictif. Ce n'est ni un prêt réel ni un gain.");
    return m;
  }

  public Map<String, Object> requestCredit(AuthUser user, UUID roomId, Map<String, Object> body) {
    MemberRow member = requireMember(roomId, user.id());
    RoomRow room = requireRoom(roomId);
    requireRoomOpen(room);
    if (member.portfolioId() == null) {
      throw new ApiException(HttpStatus.FORBIDDEN, "SPECTATOR_ONLY", "Les spectateurs ne demandent pas de crédit.");
    }
    if (member.tradingLocked()) {
      throw new ApiException(HttpStatus.CONFLICT, "CREDIT_LOCKED",
          "Plafond atteint. Remboursez votre dette ou gagnez des points via les formations.");
    }
    Rules rules = rulesOf(room);
    double amount = num(body.get("amount"), 0);
    String idem = text(body.get("idempotencyKey"), "").trim();
    if (idem.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "idempotencyKey requis.");
    }
    var existing = rooms.ledgerByIdempotency(roomId, idem);
    if (existing.isPresent()) {
      return Map.of("idempotentReplay", true, "ledger", existing.get(), "room", detail(user, roomId));
    }
    long ask = (long) Money.toAmount(amount);
    if (ask <= 0) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Montant de crédit invalide.");
    }
    long capacity = RoomEconomy.creditCeilingMillimes(rules, member.learningPoints(), member.creditDrawnMillimes());
    if (ask > capacity) {
      throw new ApiException(HttpStatus.CONFLICT, "CREDIT_DENIED",
          "Crédit refusé : capacité restante " + Money.fromAmount(capacity)
              + ". Augmentez vos points pédagogiques ou remboursez votre dette fictive.");
    }
    Instant now = now();
    try {
      tx.executeWithoutResult(status -> {
        MemberRow fresh = rooms.activeMember(roomId, user.id()).orElseThrow();
        long debt = fresh.creditDebtMillimes() + ask;
        long drawn = fresh.creditDrawnMillimes() + ask;
        portfolios.cashFlow(user, fresh.portfolioId(),
            new TradingDtos.CashFlow("DEPOSIT", Money.fromAmount(ask), portfolioVersion(fresh.portfolioId())));
        boolean lock = debt >= (long) Math.round(rules.initialCapitalMillimes() * (rules.maxCreditOutstandingPct() / 100.0));
        rooms.updateEconomy(fresh.id(), fresh.learningPoints(), debt, drawn, fresh.convertedCapitalMillimes(),
            lock, lock ? "Plafond de financement fictif atteint." : null, fresh.pedagogicalLevel(),
            fresh.lastConversionAt());
        rooms.insertLedger(roomId, fresh.id(), "CREDIT_DRAW", ask, 0, null, debt, fresh.learningPoints(), idem,
            "Crédit virtuel accordé", now);
      });
    } catch (DataIntegrityViolationException dup) {
      var replayed = rooms.ledgerByIdempotency(roomId, idem);
      if (replayed.isPresent()) {
        return Map.of("idempotentReplay", true, "ledger", replayed.get(), "room", detail(user, roomId));
      }
      throw dup;
    }
    emit(roomId, "CREDIT_GRANTED", user.id(), Map.of("amount", amount), now);
    return detail(user, roomId);
  }

  public Map<String, Object> repayCredit(AuthUser user, UUID roomId, Map<String, Object> body) {
    MemberRow member = requireMember(roomId, user.id());
    RoomRow room = requireRoom(roomId);
    if (!List.of("ACTIVE", "PAUSED").contains(room.status())) {
      throw new ApiException(HttpStatus.CONFLICT, "INVALID_STATE", "Remboursement impossible dans cet état.");
    }
    double amount = num(body.get("amount"), 0);
    String idem = text(body.get("idempotencyKey"), "").trim();
    if (idem.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "idempotencyKey requis.");
    }
    var existing = rooms.ledgerByIdempotency(roomId, idem);
    if (existing.isPresent()) {
      return Map.of("idempotentReplay", true, "ledger", existing.get(), "room", detail(user, roomId));
    }
    long repay = (long) Money.toAmount(amount);
    if (repay <= 0 || repay > member.creditDebtMillimes()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Montant de remboursement invalide.");
    }
    Instant now = now();
    try {
      tx.executeWithoutResult(status -> {
        MemberRow fresh = rooms.activeMember(roomId, user.id()).orElseThrow();
        portfolios.cashFlow(user, fresh.portfolioId(),
            new TradingDtos.CashFlow("WITHDRAWAL", Money.fromAmount(repay), portfolioVersion(fresh.portfolioId())));
        long debt = fresh.creditDebtMillimes() - repay;
        rooms.updateEconomy(fresh.id(), fresh.learningPoints(), debt, fresh.creditDrawnMillimes(),
            fresh.convertedCapitalMillimes(), false, null, fresh.pedagogicalLevel(), fresh.lastConversionAt());
        rooms.insertLedger(roomId, fresh.id(), "CREDIT_REPAY", -repay, 0, null, debt, fresh.learningPoints(), idem,
            "Remboursement de crédit virtuel", now);
      });
    } catch (DataIntegrityViolationException dup) {
      var replayed = rooms.ledgerByIdempotency(roomId, idem);
      if (replayed.isPresent()) {
        return Map.of("idempotentReplay", true, "ledger", replayed.get(), "room", detail(user, roomId));
      }
      throw dup;
    }
    emit(roomId, "CREDIT_REPAID", user.id(), Map.of("amount", amount), now);
    return detail(user, roomId);
  }

  public Map<String, Object> previewOrder(AuthUser user, UUID roomId, Map<String, Object> body) {
    MemberRow member = requireTradingMember(roomId, user);
    RoomRow room = requireRoom(roomId);
    requireRoomActive(room);
    TradingDtos.OrderTerms terms = TradingDtos.previewOrder(body);
    return withRoomClock(room, () -> portfolios.preview(user, member.portfolioId(), terms));
  }

  public Map<String, Object> submitOrder(AuthUser user, UUID roomId, Map<String, Object> body) {
    MemberRow member = requireTradingMember(roomId, user);
    RoomRow room = requireRoom(roomId);
    requireRoomActive(room);
    TradingDtos.SubmitOrder dto = TradingDtos.submitOrder(body);
    if (member.tradingLocked() && "BUY".equalsIgnoreCase(dto.terms().side())) {
      throw new ApiException(HttpStatus.CONFLICT, "TRADING_LIMITED",
          "Votre capital/crédit fictif ne permet plus d'ouvrir de nouvelles positions. "
              + "Vous pouvez vendre, rembourser, suivre une formation ou convertir des points autorisés.");
    }
    Map<String, Object> result = withRoomClock(room, () -> portfolios.submit(user, member.portfolioId(), dto));
    emit(roomId, "ORDER_EVENT", user.id(), Map.of(
        "symbol", dto.terms().symbol(),
        "side", dto.terms().side(),
        "displayName", member.displayName()), now());
    maybeLockAfterTrade(room, user.id());
    return result;
  }

  public Map<String, Object> portfolio(AuthUser user, UUID roomId) {
    MemberRow member = requireTradingMember(roomId, user);
    RoomRow room = requireRoom(roomId);
    Map<String, Object> summary = withRoomClock(room, () -> portfolios.get(user, member.portfolioId()));
    Snapshot snap = valuation.value(room, member, now());
    Map<String, Object> m = new LinkedHashMap<>(summary);
    m.put("roomContext", true);
    m.put("learningPoints", member.learningPoints());
    m.put("creditDebt", Money.fromAmount(member.creditDebtMillimes()));
    m.put("convertedCapital", Money.fromAmount(member.convertedCapitalMillimes()));
    m.put("tradingLocked", member.tradingLocked());
    m.put("lockReason", member.lockReason());
    m.put("markToMarket", valuation.toJson(snap));
    m.put("netWorth", snap.netWorth());
    m.put("grossEquity", snap.grossEquity());
    m.put("tradingReturnPct", snap.tradingReturnPct());
    m.put("equity", snap.grossEquity());
    m.put("positionsValue", snap.positionsMarketValue());
    if (!snap.valuationComplete()) {
      m.put("valuationWarning",
          "Certains cours sont indisponibles à l'horloge de simulation — la valorisation n'est pas exacte.");
    }
    return m;
  }

  public Map<String, Object> postMessage(AuthUser user, UUID roomId, Map<String, Object> body) {
    requireMember(roomId, user.id());
    String text = text(body.get("body"), "").trim();
    if (text.length() < 1 || text.length() > 500) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Message invalide (1–500 caractères).");
    }
    Instant now = now();
    if (rooms.messagesLastMinute(roomId, user.id(), now.minusSeconds(60)) >= 20) {
      throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "CHAT_RATE_LIMIT",
          "Trop de messages. Patientez une minute.");
    }
    UUID id = Db.newId();
    rooms.insertMessage(id, roomId, user.id(), text, now);
    Map<String, Object> msg = Map.of(
        "id", id.toString(),
        "senderUserId", user.id().toString(),
        "senderName", displayName(user),
        "body", text,
        "at", now.toString(),
        "status", "SENT");
    emit(roomId, "CHAT_MESSAGE", user.id(), msg, now);
    return msg;
  }

  public Map<String, Object> messages(AuthUser user, UUID roomId) {
    requireMemberOrPublic(roomId, user);
    List<Map<String, Object>> items = new ArrayList<>(rooms.recentMessages(roomId, 80));
    java.util.Collections.reverse(items);
    return Map.of("messages", items);
  }

  public Map<String, Object> marketSnapshot(AuthUser user, UUID roomId) {
    requireMemberOrPublic(roomId, user);
    RoomRow room = requireRoom(roomId);
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("marketScope", room.marketScope());
    m.put("simClockDate", room.simClockDate() == null ? null : room.simClockDate().toString());
    m.put("dataKind", "FICTIONAL".equals(room.marketScope()) ? "FICTIONAL" : "HISTORICAL");
    m.put("label", "FICTIONAL".equals(room.marketScope())
        ? "Simulateur fictif pédagogique"
        : "Simulation sur données historiques (pas un marché en direct)");
    m.put("crisisEpisodeId", room.crisisEpisodeId());
    if (!"FICTIONAL".equals(room.marketScope()) && room.simClockDate() != null && warehouse.tablesPresent()) {
      m.put("asOfPolicy", "ONLY_OBSERVATIONS_ON_OR_BEFORE_SIM_CLOCK");
      m.put("hint", "Aucun cours postérieur à " + room.simClockDate() + " n'est révélé.");
    }
    return m;
  }

  // ---------- helpers ----------

  private void maybeLockAfterTrade(RoomRow room, UUID userId) {
    MemberRow member = rooms.activeMember(room.id(), userId).orElse(null);
    if (member == null || member.portfolioId() == null) return;
    Rules rules = rulesOf(room);
    var pf = trading.portfolio(member.portfolioId());
    long cash = pf.cash();
    if (cash <= 0 && member.creditDebtMillimes() >= (long) Math.round(
        rules.initialCapitalMillimes() * (rules.maxCreditOutstandingPct() / 100.0))) {
      rooms.updateEconomy(member.id(), member.learningPoints(), member.creditDebtMillimes(),
          member.creditDrawnMillimes(), member.convertedCapitalMillimes(), true,
          "Capital disponible insuffisant et plafond de crédit atteint. Formez-vous ou remboursez.",
          member.pedagogicalLevel(), member.lastConversionAt());
      emit(room.id(), "TRADING_LIMITED", userId, Map.of("reason", "capital_credit_cap"), now());
    }
  }

  private List<Map<String, Object>> leaderboard(RoomRow room) {
    List<Map<String, Object>> rows = new ArrayList<>();
    Instant now = now();
    boolean anyIncomplete = false;
    for (MemberRow m : rooms.activeMembers(room.id())) {
      if (m.portfolioId() == null) continue;
      Snapshot snap = valuation.value(room, m, now);
      if (!snap.valuationComplete()) anyIncomplete = true;
      double drawdownProxy = snap.unrealizedPnl() < 0
          ? Math.abs(snap.unrealizedPnl() / Math.max(1.0, snap.initialCapital())) * 100.0
          : 0.0;
      if (snap.realizedPnl() < 0) {
        drawdownProxy = Math.max(drawdownProxy,
            Math.abs(snap.realizedPnl() / Math.max(1.0, snap.initialCapital())) * 100.0);
      }
      int missionsDone = rooms.countMissionRewards(m.id());
      double score = RoomEconomy.pedagogicalScore(
          snap.tradingReturnPct(), drawdownProxy, m.learningPoints(), missionsDone, m.tradingLocked());
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("displayName", m.displayName());
      row.put("level", m.pedagogicalLevel());
      row.put("learningPoints", m.learningPoints());
      row.put("missionsCompleted", missionsDone);
      row.put("grossEquity", snap.grossEquity());
      row.put("netWorth", snap.netWorth());
      row.put("equity", snap.netWorth());
      row.put("tradingReturnPct", Math.round(snap.tradingReturnPct() * 10.0) / 10.0);
      row.put("creditDebt", snap.creditDebt());
      row.put("externalCapital", snap.externalCapital());
      row.put("unrealizedPnl", snap.unrealizedPnl());
      row.put("valuationComplete", snap.valuationComplete());
      row.put("score", snap.valuationComplete() ? score : null);
      row.put("scoreProvisional", !snap.valuationComplete());
      row.put("tradingLocked", m.tradingLocked());
      if (!snap.valuationComplete()) {
        row.put("scoreNote", "Score non affiché comme exact — cours manquants ou devises hétérogènes.");
      }
      rows.add(row);
    }
    rows.sort((a, b) -> {
      Double sa = a.get("score") instanceof Number n ? n.doubleValue() : Double.NEGATIVE_INFINITY;
      Double sb = b.get("score") instanceof Number n ? n.doubleValue() : Double.NEGATIVE_INFINITY;
      return Double.compare(sb, sa);
    });
    int rank = 1;
    for (Map<String, Object> r : rows) r.put("rank", rank++);
    if (anyIncomplete) {
      for (Map<String, Object> r : rows) {
        r.putIfAbsent("rankingDisclaimer",
            "Classement partiellement provisoire : certains cours manquent à l'horloge de simulation.");
      }
    }
    return rows;
  }

  private <T> T withRoomClock(RoomRow room, java.util.function.Supplier<T> action) {
    try {
      if (room.simClockDate() != null && !"FICTIONAL".equalsIgnoreCase(room.marketScope())) {
        RoomQuoteContext.setAsOf(room.simClockDate());
      }
      return action.get();
    } finally {
      RoomQuoteContext.clear();
    }
  }

  private UUID createRoomPortfolio(UUID userId, String code, long capitalMillimes, Instant now) {
    UUID portfolioId = Db.newId();
    String name = "Salle " + code;
    try {
      trading.insertPortfolio(portfolioId, userId, name, capitalMillimes,
          TradingRules.DEFAULT_MAX_POSITION_WEIGHT_PCT, now);
    } catch (DuplicateKeyException e) {
      name = "Salle " + code + " · " + now.toEpochMilli();
      trading.insertPortfolio(portfolioId, userId, name, capitalMillimes,
          TradingRules.DEFAULT_MAX_POSITION_WEIGHT_PCT, now);
    }
    trading.insertCashEntry(portfolioId, 1, "DEPOSIT", capitalMillimes, capitalMillimes, null,
        "Capital fictif de salle", now);
    trading.insertSnapshot(new TradingRepository.NewSnapshot(portfolioId, "OPENING", 0, 0, 0, capitalMillimes,
        capitalMillimes, now));
    return portfolioId;
  }

  private int portfolioVersion(UUID portfolioId) {
    return trading.portfolio(portfolioId).version();
  }

  private boolean missionCompleted(UUID userId, String slug) {
    try {
      Integer n = jdbc.sql("""
          SELECT COUNT(*)::int FROM learning_sessions s
          JOIN learning_assessments a ON a.session_id = s.id
          WHERE s.user_id = ? AND s.mission_slug = ? AND a.passed = TRUE
          """)
          .params(userId, slug).query(Integer.class).single();
      return n != null && n > 0;
    } catch (Exception e) {
      // If learning tables diverge, fall back to allowing QUIZ/TUTORIAL only — missions require evidence.
      return false;
    }
  }

  private LocalDate crisisStart(String episodeId) {
    try {
      return jdbc.sql("SELECT start_date FROM market_crisis_episodes WHERE id = ?")
          .param(episodeId).query(LocalDate.class).optional().orElse(LocalDate.of(2020, 2, 20));
    } catch (Exception e) {
      return LocalDate.of(2020, 2, 20);
    }
  }

  private void emit(UUID roomId, String type, UUID actor, Map<String, Object> payload, Instant now) {
    long seq = rooms.nextEventSeq(roomId);
    rooms.insertEvent(roomId, seq, type, actor, writeJson(payload), now);
    Map<String, Object> event = new LinkedHashMap<>();
    event.put("seq", seq);
    event.put("type", type);
    event.put("actorUserId", actor == null ? null : actor.toString());
    event.put("payload", payload);
    event.put("at", now.toString());
    hub.publish(roomId, type, event);
  }

  private Map<String, Object> roomDetail(RoomRow room, MemberRow me, AuthUser user) {
    Rules rules = rulesOf(room);
    Map<String, Object> m = roomSummary(room);
    m.put("rules", rules.toJson());
    m.put("members", rooms.activeMembers(room.id()).stream().map(this::memberPublic).toList());
    m.put("leaderboard", leaderboard(room));
    m.put("scoreExplanation", RoomEconomy.scoreExplanation());
    m.put("you", me == null ? null : memberPrivate(me, room));
    m.put("isHost", room.hostUserId().equals(user.id()));
    m.put("canModerate", me != null && List.of("HOST", "FACILITATOR").contains(me.role()));
    m.put("market", marketSnapshot(user, room.id()));
    m.put("voice", Map.of(
        "available", false,
        "reason",
        "Communication vocale de salle non déployée (pas d'infrastructure WebRTC/SFU dans ce stack). "
            + "Le chat texte est opérationnel. Micro désactivé par défaut."));
    m.put("recoveryHints", List.of(
        "Terminez une mission MarketQuest puis réclamez des points dans la salle.",
        "Convertissez des points en capital fictif selon le taux affiché.",
        "Remboursez votre dette virtuelle pour débloquer le financement.",
        "Vous conservez l'accès aux formations même si le trading est limité."));
    return m;
  }

  private Map<String, Object> roomSummary(RoomRow room) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", room.id().toString());
    m.put("code", room.code());
    m.put("title", room.title());
    m.put("description", room.description());
    m.put("visibility", room.visibility());
    m.put("mode", room.mode());
    m.put("status", room.status());
    m.put("marketScope", room.marketScope());
    m.put("crisisEpisodeId", room.crisisEpisodeId());
    m.put("simClockDate", room.simClockDate() == null ? null : room.simClockDate().toString());
    m.put("participantCount", rooms.activeMemberCount(room.id()));
    m.put("maxParticipants", room.maxParticipants());
    m.put("eventSeq", room.eventSeq());
    m.put("createdAt", room.createdAt().toString());
    return m;
  }

  private Map<String, Object> memberPublic(MemberRow m) {
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("displayName", m.displayName());
    row.put("role", m.role());
    row.put("level", m.pedagogicalLevel());
    row.put("learningPoints", m.learningPoints());
    row.put("tradingLocked", m.tradingLocked());
    row.put("joinedAt", m.joinedAt().toString());
    return row;
  }

  private Map<String, Object> memberPrivate(MemberRow m, RoomRow room) {
    Map<String, Object> row = memberPublic(m);
    row.put("memberId", m.id().toString());
    row.put("portfolioId", m.portfolioId() == null ? null : m.portfolioId().toString());
    row.put("creditDebt", Money.fromAmount(m.creditDebtMillimes()));
    row.put("creditDrawn", Money.fromAmount(m.creditDrawnMillimes()));
    row.put("convertedCapital", Money.fromAmount(m.convertedCapitalMillimes()));
    row.put("lockReason", m.lockReason());
    if (m.portfolioId() != null) {
      Snapshot snap = valuation.value(room, m, now());
      row.put("netWorth", snap.netWorth());
      row.put("grossEquity", snap.grossEquity());
      row.put("tradingReturnPct", snap.tradingReturnPct());
      row.put("valuationComplete", snap.valuationComplete());
    }
    return row;
  }

  private Map<String, Object> onboardingCopy() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("steps", List.of(
        "Créez ou rejoignez une salle (code d'invitation).",
        "Recevez un capital fictif — ce n'est pas de l'argent réel.",
        "Achetez/vendez via le ticket de la salle.",
        "Gagnez des points en terminant missions et quiz.",
        "Demandez un crédit virtuel seulement si les règles le permettent."));
    m.put("threeBalances", List.of(
        Map.of("id", "capital", "label", "Capital fictif", "hint", "Pour trader dans la simulation"),
        Map.of("id", "points", "label", "Points d'apprentissage", "hint", "Récompensent l'apprentissage, pas la spéculation"),
        Map.of("id", "credit", "label", "Crédit virtuel", "hint", "Emprunt fictif = dette, jamais un gain")));
    return m;
  }

  @SuppressWarnings("unchecked")
  private Rules rulesOf(RoomRow room) {
    try {
      Map<String, Object> raw = new com.fasterxml.jackson.databind.ObjectMapper()
          .readValue(room.rulesJson(), Map.class);
      return Rules.fromJson(raw);
    } catch (Exception e) {
      return Rules.defaults();
    }
  }

  private RoomRow requireRoom(UUID id) {
    return rooms.room(id).orElseThrow(() ->
        new ApiException(HttpStatus.NOT_FOUND, "ROOM_NOT_FOUND", "Salle introuvable."));
  }

  private MemberRow requireMember(UUID roomId, UUID userId) {
    return rooms.activeMember(roomId, userId).orElseThrow(() ->
        new ApiException(HttpStatus.FORBIDDEN, "NOT_A_MEMBER", "Rejoignez la salle pour continuer."));
  }

  private MemberRow requireTradingMember(UUID roomId, AuthUser user) {
    MemberRow m = requireMember(roomId, user.id());
    if (m.portfolioId() == null || "SPECTATOR".equals(m.role())) {
      throw new ApiException(HttpStatus.FORBIDDEN, "SPECTATOR_ONLY",
          "Les spectateurs consultent sans trader.");
    }
    return m;
  }

  private RoomRow requireHostOrFacilitator(UUID roomId, AuthUser user) {
    RoomRow room = requireRoom(roomId);
    MemberRow m = rooms.activeMember(roomId, user.id()).orElse(null);
    if (room.hostUserId().equals(user.id())) return room;
    if (m != null && "FACILITATOR".equals(m.role())) return room;
    throw new ApiException(HttpStatus.FORBIDDEN, "HOST_REQUIRED", "Action réservée à l'hôte ou à l'animateur.");
  }

  private void requireMemberOrPublic(UUID roomId, AuthUser user) {
    RoomRow room = requireRoom(roomId);
    if ("PUBLIC".equals(room.visibility())) return;
    requireMember(roomId, user.id());
  }

  private void requireRoomActive(RoomRow room) {
    if (!"ACTIVE".equals(room.status())) {
      throw new ApiException(HttpStatus.CONFLICT, "ROOM_NOT_ACTIVE",
          "La simulation n'est pas active. Attendez le démarrage par l'hôte.");
    }
  }

  private void requireRoomOpen(RoomRow room) {
    if ("ENDED".equals(room.status())) {
      throw new ApiException(HttpStatus.CONFLICT, "ROOM_ENDED", "Cette salle est terminée.");
    }
  }

  private void assertAvailable() {
    if (!rooms.tablesPresent()) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ROOMS_UNAVAILABLE",
          "Le module Salles n'est pas encore migré sur cette base.");
    }
  }

  private String uniqueCode() {
    for (int i = 0; i < 8; i++) {
      StringBuilder sb = new StringBuilder(6);
      for (int c = 0; c < 6; c++) sb.append(CODE_ALPHABET.charAt(RNG.nextInt(CODE_ALPHABET.length())));
      String code = sb.toString();
      if (rooms.roomByCode(code).isEmpty()) return code;
    }
    throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "CODE_GEN_FAILED", "Impossible de générer un code.");
  }

  private String displayName(AuthUser user) {
    String first = user.user().firstName() == null ? "" : user.user().firstName().trim();
    String last = user.user().lastName() == null ? "" : user.user().lastName().trim();
    String full = (first + " " + last).trim();
    return full.isEmpty() ? user.user().email() : full;
  }

  private Instant now() {
    return clock.instant().truncatedTo(ChronoUnit.MILLIS);
  }

  private static String text(Object v, String fallback) {
    return v == null ? fallback : String.valueOf(v).trim();
  }

  private static double num(Object v, double fallback) {
    if (v instanceof Number n) return n.doubleValue();
    if (v instanceof String s) {
      try {
        return Double.parseDouble(s);
      } catch (NumberFormatException e) {
        return fallback;
      }
    }
    return fallback;
  }

  private static String writeJson(Map<String, Object> map) {
    try {
      return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(map);
    } catch (Exception e) {
      return "{}";
    }
  }
}
