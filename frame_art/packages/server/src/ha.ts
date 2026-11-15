/** Home Assistant Core and Supervisor, through the Supervisor proxy (homeassistant_api: true). */
export interface MqttConn {
  host: string
  port: number
  username?: string
  password?: string
  ssl?: boolean
}

export interface HomeAssistant {
  readonly available: boolean
  callService(domain: string, service: string, data: Record<string, unknown>): Promise<boolean>
  mqttService(): Promise<MqttConn | null>
}

export class SupervisorHA implements HomeAssistant {
  constructor(
    private readonly token: string | null,
    private readonly base = "http://supervisor",
  ) {}

  get available() {
    return Boolean(this.token)
  }

  private headers() {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }
  }

  async callService(domain: string, service: string, data: Record<string, unknown>) {
    if (!this.token) return false
    try {
      const r = await fetch(`${this.base}/core/api/services/${domain}/${service}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(20_000),
      })
      return r.ok
    } catch {
      return false
    }
  }

  async mqttService(): Promise<MqttConn | null> {
    if (!this.token) return null
    try {
      const r = await fetch(`${this.base}/services/mqtt`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      })
      if (!r.ok) return null
      return ((await r.json()) as { data?: MqttConn }).data ?? null
    } catch {
      return null
    }
  }
}
