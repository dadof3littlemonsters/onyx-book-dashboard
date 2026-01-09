// Global timeout utility for all API requests
class TimeoutHandler {
  static createAbortController(timeoutMs = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    return { controller, timeoutId };
  }

  static async fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const { controller, timeoutId } = this.createAbortController(timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
      }
      throw error;
    }
  }

  static logAuthHeader(service, token, extra = '') {
    if (!token) {
      console.log(`[DEBUG] ${service} Header: No token provided ${extra}`);
      return;
    }

    const masked = token.length > 8 ?
      `Bearer ${token.substring(0,8)}....` :
      'Bearer [SHORT_TOKEN]';

    console.log(`[DEBUG] ${service} Header: ${masked} ${extra}`);
  }

  static handleError(service, error, fallbackMessage = 'Service unavailable') {
    console.error(`[${service.toUpperCase()} ERROR] ${error.message}`);
    console.log(`[${service.toUpperCase()} ERROR] Fallback to local mode and proceeding`);
    return {
      success: false,
      error: error.message,
      fallback: fallbackMessage
    };
  }
}

module.exports = TimeoutHandler;