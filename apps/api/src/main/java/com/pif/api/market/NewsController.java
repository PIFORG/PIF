package com.pif.api.market;

import com.pif.api.security.AuthUser;
import com.pif.api.web.RouteAnnotations.Throttle;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/market/news")
@Throttle(limit = 120, ttlSeconds = 60)
@Tag(name = "Actualites")
public class NewsController {

  private final NewsService news;

  public NewsController(NewsService news) {
    this.news = news;
  }

  @GetMapping
  @Operation(summary = "Fil d'actualites pedagogiques synthetiques")
  public Map<String, Object> feed(HttpServletRequest req) {
    AuthUser.from(req);
    return news.feed();
  }
}