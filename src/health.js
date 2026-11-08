/**
 * Health Check & Gateway Monitoring Module
 *
 * Provides:
 * 1. HTTP health endpoint for external monitoring (UptimeRobot, Render, etc.)
 * 2. Discord gateway connection state tracking
 * 3. Automatic reconnection handling
 * 4. Interaction watchdog - detects zombie bot (connected but not processing)
 * 5. Health metrics for debugging
 */

const { GatewayIntentBits } = require('discord.js');

class HealthMonitor {
  constructor(client, options = {}) {
    this.client = client;
    this.startTime = Date.now();
    this.lastHeartbeat = null;
    this.lastGatewayEvent = null;
    this.gatewayLatency = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.reconnectDelayBase = options.reconnectDelayBase || 5000; // 5s base
    this.maxReconnectDelay = options.maxReconnectDelay || 300000; // 5 min max
    this.healthCheckInterval = null;
    this.isShuttingDown = false;

    // ===== INTERACTION WATCHDOG =====
    // Tracks when the last interaction was successfully processed
    this.lastInteractionAt = null;
    this.interactionStuckThresholdMs = options.interactionStuckThresholdMs || 120_000; // 2 min sem interação = travado
    this.interactionCheckEnabled = options.interactionCheckEnabled !== false; // enabled by default

    // Bind event handlers
    this._setupGatewayListeners();
  }

  _setupGatewayListeners() {
    // Track gateway connection state
    this.client.ws.on('open', () => {
      this.lastGatewayEvent = { type: 'open', timestamp: Date.now() };
      this.reconnectAttempts = 0;
      console.log('[HEALTH] Gateway connected');
    });

    this.client.ws.on('close', (code, reason) => {
      this.lastGatewayEvent = { type: 'close', code, reason, timestamp: Date.now() };
      console.warn(`[HEALTH] Gateway closed: ${code} - ${reason}`);
    });

    this.client.ws.on('error', (error) => {
      this.lastGatewayEvent = { type: 'error', error: error.message, timestamp: Date.now() };
      console.error('[HEALTH] Gateway error:', error);
    });

    this.client.ws.on('reconnecting', () => {
      this.reconnectAttempts++;
      this.lastGatewayEvent = { type: 'reconnecting', attempt: this.reconnectAttempts, timestamp: Date.now() };
      console.log(`[HEALTH] Reconnecting... (attempt ${this.reconnectAttempts})`);
    });

    // Heartbeat tracking
    this.client.ws.on('heartbeat', () => {
      this.lastHeartbeat = Date.now();
    });

    // Latency tracking via heartbeat ack
    const originalSend = this.client.ws.send.bind(this.client.ws);
    this.client.ws.send = (data) => {
      if (data && typeof data === 'object' && data.op === 1) { // Heartbeat
        this._heartbeatSentAt = Date.now();
      }
      return originalSend(data);
    };

    // Track heartbeat ACK for latency
    this.client.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.op === 11) { // Heartbeat ACK
          if (this._heartbeatSentAt) {
            this.gatewayLatency = Date.now() - this._heartbeatSentAt;
            this._heartbeatSentAt = null;
          }
        }
      } catch {}
    });
  }

  /**
   * Call this on every successful interaction processing
   * Updates the watchdog timestamp
   */
  markInteractionProcessed() {
    this.lastInteractionAt = Date.now();
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(intervalMs = 30000) {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(() => {
      this._performHealthCheck();
    }, intervalMs);

    console.log('[HEALTH] Periodic health checks started');
    if (this.interactionCheckEnabled) {
      console.log(`[HEALTH] Interaction watchdog ATIVO (threshold: ${this.interactionStuckThresholdMs / 1000}s)`);
    }
  }

  stopHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  _performHealthCheck() {
    const now = Date.now();
    const uptime = now - this.startTime;

    // Check if gateway is responsive
    const gatewayHealthy = this.client.ws.status === 0 && // WebSocket.OPEN
                           this.lastHeartbeat &&
                           (now - this.lastHeartbeat) < 60000; // heartbeat within 60s

    // Check if we're stuck in reconnecting
    const stuckReconnecting = this.reconnectAttempts > this.maxReconnectAttempts;

    // ===== INTERACTION WATCHDOG =====
    // If bot is "ready" but hasn't processed interactions for too long, it's zombie
    let interactionStuck = false;
    let timeSinceLastInteraction = null;
    if (this.interactionCheckEnabled && this.client.isReady() && this.lastInteractionAt) {
      timeSinceLastInteraction = now - this.lastInteractionAt;
      interactionStuck = timeSinceLastInteraction > this.interactionStuckThresholdMs;
    }

    // Log health status periodically (every 5 min)
    if (Math.floor(uptime / 300000) !== Math.floor((uptime - 30000) / 300000)) {
      console.log(`[HEALTH] Status: gateway=${gatewayHealthy ? 'healthy' : 'unhealthy'}, ` +
                  `latency=${this.gatewayLatency ?? 'unknown'}ms, ` +
                  `reconnects=${this.reconnectAttempts}, ` +
                  `uptime=${Math.floor(uptime / 1000)}s` +
                  (this.lastInteractionAt ? `, lastInteraction=${Math.floor((now - this.lastInteractionAt) / 1000)}s ago` : ''));
    }

    // If gateway is unhealthy and we're not shutting down, trigger reconnect
    if (!gatewayHealthy && !this.isShuttingDown && this.client.ws.status !== 0) {
      console.warn('[HEALTH] Gateway unhealthy, attempting reconnect...');
      this._forceReconnect();
    }

    // ===== INTERACTION WATCHDOG ACTION =====
    // Bot is "ready" and gateway "connected" but not processing interactions -> ZOMBIE
    if (interactionStuck && !this.isShuttingDown) {
      console.error(`[HEALTH] 🧟 ZOMBIE DETECTED! Bot pronto mas sem processar interações há ${Math.round(timeSinceLastInteraction / 1000)}s. Forçando reconexão...`);
      this._forceReconnect();
      // Also mark as stuck so we can track it
      this.lastGatewayEvent = { type: 'zombie_detected', timeSinceLastInteraction, timestamp: now };
    }

    // If stuck reconnecting too many times, hard exit for Render to restart
    if (stuckReconnecting && !this.isShuttingDown) {
      console.error('[HEALTH] Max reconnect attempts reached, forcing process exit for restart');
      process.exit(1);
    }
  }

  _forceReconnect() {
    // discord.js handles reconnection automatically, but we can force it
    // by destroying the current connection
    if (this.client.ws && this.client.ws.status === 1) { // CONNECTING
      return; // Already trying to reconnect
    }
    this.client.ws.close(4000, 'Health check forced reconnect');
  }

  /**
   * Get current health status for HTTP endpoint
   */
  getStatus() {
    const now = Date.now();
    const uptime = now - this.startTime;

    let timeSinceLastInteraction = null;
    let interactionStuck = false;
    if (this.lastInteractionAt) {
      timeSinceLastInteraction = now - this.lastInteractionAt;
      interactionStuck = this.interactionCheckEnabled && this.client.isReady() && timeSinceLastInteraction > this.interactionStuckThresholdMs;
    }

    return {
      status: this._getOverallStatus(),
      uptime: uptime,
      uptimeHuman: this._formatUptime(uptime),
      gateway: {
        connected: this.client.ws.status === 0, // WebSocket.OPEN
        status: this._getWsStatusName(this.client.ws.status),
        latency: this.gatewayLatency,
        lastHeartbeat: this.lastHeartbeat ? now - this.lastHeartbeat : null,
        lastEvent: this.lastGatewayEvent,
        reconnectAttempts: this.reconnectAttempts,
      },
      discord: {
        ready: this.client.isReady(),
        user: this.client.user?.tag ?? null,
        guilds: this.client.guilds.cache.size,
        users: this.client.users.cache.size,
        channels: this.client.channels.cache.size,
        voiceConnections: this.client.voiceAdapters?.size ?? 0,
      },
      interactionWatchdog: {
        enabled: this.interactionCheckEnabled,
        lastInteractionAt: this.lastInteractionAt ? new Date(this.lastInteractionAt).toISOString() : null,
        timeSinceLastInteractionMs: timeSinceLastInteraction,
        stuck: interactionStuck,
        thresholdMs: this.interactionStuckThresholdMs,
      },
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      timestamp: new Date().toISOString(),
    };
  }

  _getOverallStatus() {
    if (this.isShuttingDown) return 'shutting_down';
    if (!this.client.isReady()) return 'starting';
    if (this.client.ws.status !== 0) return 'degraded';
    if (this.reconnectAttempts > this.maxReconnectAttempts * 0.5) return 'degraded';

    // Check interaction watchdog
    if (this.interactionCheckEnabled && this.lastInteractionAt) {
      const timeSinceLastInteraction = Date.now() - this.lastInteractionAt;
      if (timeSinceLastInteraction > this.interactionStuckThresholdMs) {
        return 'zombie'; // Connected but not processing
      }
    }

    return 'healthy';
  }

  _getWsStatusName(status) {
    const names = {
      0: 'CONNECTED',
      1: 'CONNECTING',
      2: 'DISCONNECTING',
      3: 'DISCONNECTED',
    };
    return names[status] ?? `UNKNOWN(${status})`;
  }

  _formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(' ');
  }

  /**
   * Signal graceful shutdown
   */
  async shutdown() {
    this.isShuttingDown = true;
    this.stopHealthChecks();
    console.log('[HEALTH] Shutdown initiated');
  }
}

/**
 * Create HTTP health check server
 * Exposes:
 *  - GET /health       -> Full health status (JSON)
 *  - GET /health/ready -> Readiness probe (200 if ready, 503 if not)
 *  - GET /health/live  -> Liveness probe (200 if process alive)
 */
function createHealthServer(healthMonitor, port = process.env.PORT || 3000) {
  const http = require('http');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const path = url.pathname;

    // CORS headers for external monitoring
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (path === '/health' || path === '/health/') {
        const status = healthMonitor.getStatus();
        const code = status.status === 'healthy' ? 200 : (status.status === 'starting' ? 200 : 503);
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));
      }
      else if (path === '/health/ready') {
        const status = healthMonitor.getStatus();
        const ready = status.status === 'healthy' || status.status === 'degraded';
        res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ready, status: status.status }));
      }
      else if (path === '/health/live') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ alive: true, uptime: Date.now() - healthMonitor.startTime }));
      }
      else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found', paths: ['/health', '/health/ready', '/health/live'] }));
      }
    } catch (err) {
      console.error('[HEALTH] HTTP error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  });

  server.listen(port, () => {
    console.log(`[HEALTH] HTTP server listening on port ${port}`);
  });

  return server;
}

module.exports = { HealthMonitor, createHealthServer };