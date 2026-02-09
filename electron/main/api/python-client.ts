import axios, { AxiosInstance, AxiosError } from "axios";

export class PythonClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string = "http://127.0.0.1:8001") {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 60000, // 60 second timeout (LLM can take time)
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  async optimize(
    prompt: string,
    skipCache: boolean = false,
    messages?: Array<{ role: string; content: string }>
  ): Promise<string> {
    const timestamp = new Date().toISOString();
    const startTime = Date.now();
    console.log(`[${timestamp}] [PythonClient.optimize] START - Prompt length: ${prompt.length} chars, skipCache: ${skipCache}, hasHistory: ${!!messages}`);
    console.log(`[${timestamp}] [PythonClient.optimize] URL: ${this.baseUrl}/optimize`);

    try {
      console.log(`[${timestamp}] [PythonClient.optimize] Sending POST request...`);
      const requestStartTime = Date.now();
      const response = await this.client.post("/optimize", {
        prompt,
        skip_cache: skipCache,
        messages: messages || null  // Send chat history if provided
      });
      const requestElapsed = Date.now() - requestStartTime;

      console.log(`[${timestamp}] [PythonClient.optimize] ✓ Response received in ${requestElapsed}ms`);
      console.log(`[${timestamp}] [PythonClient.optimize] Response status: ${response.status}`);
      console.log(`[${timestamp}] [PythonClient.optimize] Response data keys:`, Object.keys(response.data || {}));

      if (response.data && response.data.optimized) {
        const totalElapsed = Date.now() - startTime;
        console.log(`[${new Date().toISOString()}] [PythonClient.optimize] ✓ COMPLETE - Optimized text length: ${response.data.optimized.length} chars (${totalElapsed}ms total)`);
        return response.data.optimized;
      }

      console.error(`[${new Date().toISOString()}] [PythonClient.optimize] ✗ Invalid response format:`, response.data);
      throw new Error("Invalid response format");
    } catch (error) {
      const totalElapsed = Date.now() - startTime;
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
          console.error(`[${new Date().toISOString()}] [PythonClient.optimize] ✗ ERROR after ${totalElapsed}ms - Status: ${axiosError.response.status}, StatusText: ${axiosError.response.statusText}`);
          console.error(`[${new Date().toISOString()}] [PythonClient.optimize] Response data:`, axiosError.response.data);
          throw new Error(
            `Optimization failed: ${axiosError.response.status} - ${axiosError.response.statusText}`
          );
        } else if (axiosError.request) {
          console.error(`[${new Date().toISOString()}] [PythonClient.optimize] ✗ ERROR after ${totalElapsed}ms - No response from server`);
          throw new Error("Python service is not responding. Please ensure it's running.");
        } else {
          console.error(`[${new Date().toISOString()}] [PythonClient.optimize] ✗ ERROR after ${totalElapsed}ms - Request setup failed:`, axiosError.message);
          throw new Error(`Request failed: ${axiosError.message}`);
        }
      }
      console.error(`[${new Date().toISOString()}] [PythonClient.optimize] ✗ ERROR after ${totalElapsed}ms:`, error);
      throw error;
    }
  }

  async optimizeStream(
    prompt: string,
    skipCache: boolean = false,
    messages: Array<{ role: string; content: string }> | null = null,
    onChunk: (chunk: string, accumulated: string) => void
  ): Promise<string> {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [PythonClient.optimizeStream] START - Prompt length: ${prompt.length} chars, skipCache: ${skipCache}`);

    return new Promise((resolve, reject) => {
      const WebSocket = require('ws');
      const wsUrl = `${this.baseUrl.replace('http', 'ws')}/ws/optimize-stream`;
      console.log(`[${timestamp}] [PythonClient.optimizeStream] Connecting to: ${wsUrl}`);

      const ws = new WebSocket(wsUrl);
      let accumulatedText = "";
      let hasReceivedData = false;

      ws.on('open', () => {
        console.log(`[${timestamp}] [PythonClient.optimizeStream] ✓ WebSocket connected`);
        // Send prompt data
        ws.send(JSON.stringify({
          prompt,
          skip_cache: skipCache,
          messages: messages
        }));
        console.log(`[${timestamp}] [PythonClient.optimizeStream] ✓ Prompt sent, waiting for chunks...`);
      });

      ws.on('message', (data: any) => {
        hasReceivedData = true;
        const message = JSON.parse(data.toString());

        if (message.type === 'chunk') {
          accumulatedText = message.accumulated;
          onChunk(message.content, accumulatedText);

          // Log progress occasionally
          if (accumulatedText.length % 100 < message.content.length) {
            console.log(`[${new Date().toISOString()}] [PythonClient.optimizeStream] Received ${accumulatedText.length} chars so far`);
          }
        } else if (message.type === 'complete') {
          console.log(`[${new Date().toISOString()}] [PythonClient.optimizeStream] ✓ COMPLETE - Final text length: ${message.optimized.length} chars`);
          resolve(message.optimized);
          ws.close();
        } else if (message.type === 'error') {
          console.error(`[${new Date().toISOString()}] [PythonClient.optimizeStream] ✗ ERROR: ${message.message}`);
          reject(new Error(message.message));
          ws.close();
        }
      });

      ws.on('error', (error: Error) => {
        console.error(`[${new Date().toISOString()}] [PythonClient.optimizeStream] ✗ WebSocket error:`, error.message);
        if (!hasReceivedData) {
          reject(new Error(`WebSocket connection failed: ${error.message}. Please ensure Python service is running.`));
        } else {
          reject(error);
        }
        ws.close();
      });

      ws.on('close', () => {
        console.log(`[${new Date().toISOString()}] [PythonClient.optimizeStream] WebSocket closed`);
        if (!hasReceivedData) {
          reject(new Error('WebSocket closed without receiving data'));
        }
      });
    });
  }

  async healthCheck(): Promise<boolean> {
    // Retry logic with delays
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.log(`[PythonClient] Health check attempt ${attempt + 1}/3 to ${this.baseUrl}/health`);
        const response = await this.client.get("/health", { timeout: 5000 });
        console.log(`[PythonClient] Health check response:`, response.data);
        if (response.data && response.data.status === "ok") {
          console.log(`[PythonClient] Health check successful!`);
          return true;
        } else {
          console.warn(`[PythonClient] Health check returned non-ok status:`, response.data);
        }
      } catch (error: any) {
        console.error(`[PythonClient] Health check attempt ${attempt + 1} failed:`, error.message);
        if (error.code) {
          console.error(`[PythonClient] Error code:`, error.code);
        }
        if (error.response) {
          console.error(`[PythonClient] Response status:`, error.response.status);
          console.error(`[PythonClient] Response data:`, error.response.data);
        }
        if (attempt < 2) {
          // Wait before retry (except on last attempt)
          console.log(`[PythonClient] Retrying in 1 second...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
      }
    }
    console.error(`[PythonClient] All health check attempts failed`);
    return false;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url;
    this.client.defaults.baseURL = url;
  }
}
