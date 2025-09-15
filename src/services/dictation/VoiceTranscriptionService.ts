import { Logger } from "@services/logging/Logger"
import axios from "axios"
import { ClineAccountService } from "@/services/account/ClineAccountService"

export class VoiceTranscriptionService {
	private clineAccountService: ClineAccountService

	constructor() {
		this.clineAccountService = ClineAccountService.getInstance()
	}

	async transcribeAudio(audioBase64: string, language?: string): Promise<{ text?: string; error?: string }> {
		try {
			Logger.info("Transcribing audio with Cline transcription service...")

			// Check if using organization account for telemetry
			const userInfo = await this.clineAccountService.fetchMe()
			const activeOrg = userInfo?.organizations?.find((org) => org.active)
			const isOrgAccount = !!activeOrg

			const result = await this.clineAccountService.transcribeAudio(audioBase64, language)

			Logger.info("Transcription successful")

			// Capture telemetry with account type - use dynamic import to avoid circular dependency
			try {
				const { telemetryService } = await import("@/services/telemetry")
				telemetryService.captureVoiceTranscriptionCompleted(
					undefined, // taskId
					result.text?.length,
					undefined, // duration
					language,
					isOrgAccount,
				)
			} catch (e) {
				// Telemetry is optional, don't fail if it's not available
				Logger.warn(`Could not capture telemetry for voice transcription: ${e}`)
			}

			return { text: result.text }
		} catch (error) {
			Logger.error("Voice transcription error:", error)

			// Handle axios errors with proper status code mapping
			if (axios.isAxiosError(error)) {
				const status = error.response?.status
				// Extract error message from server response - check both 'error' and 'message' fields
				const message = error.response?.data?.error || error.response?.data?.message || error.message

				// Check for network errors FIRST (these don't have status codes)
				if (message.includes("ENOTFOUND")) {
					return { error: "No internet connection. Please check your network and try again." }
				}
				if (message.includes("ECONNREFUSED")) {
					return { error: "Cannot connect to transcription service. Please check your internet connection." }
				}
				if (message.includes("ETIMEDOUT") || message.includes("ECONNRESET")) {
					return { error: "Connection timed out. Please check your internet connection and try again." }
				}
				if (message.includes("Network Error")) {
					return { error: "Network error. Please check your internet connection." }
				}

				// Then check status codes for server responses
				switch (status) {
					case 401:
						return { error: "Authentication failed. Please reauthenticate your Cline account" }
					case 402:
						return { error: "Insufficient credits for transcription service." }
					case 400:
						// Parse the actual error message from the server
						if (
							message.toLowerCase().includes("insufficient balance") ||
							message.toLowerCase().includes("insufficient credits")
						) {
							return { error: "Insufficient credits for transcription service." }
						}
						if (message.toLowerCase().includes("invalid audio") || message.toLowerCase().includes("invalid format")) {
							return { error: "Invalid audio format. Please try recording again." }
						}
						if (message.toLowerCase().includes("exceeds") && message.toLowerCase().includes("limit")) {
							return { error: message } // Show the actual limit exceeded message
						}
						// For other 400 errors, show the server's message if available, otherwise use generic
						return { error: message || "Invalid audio format or request data." }
					case 500:
						return { error: "Transcription server error. Please try again later." }
					default:
						// Only show the raw message if it's not a network error we already handled
						return { error: `Transcription failed: ${message}` }
				}
			}

			// Handle network errors
			const errorMessage = error instanceof Error ? error.message : String(error)

			// Handle DNS/network errors when WiFi is down
			if (errorMessage.includes("ENOTFOUND")) {
				return { error: "No internet connection. Please check your network and try again." }
			}

			if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("Network Error")) {
				return { error: "Cannot connect to transcription service. Please check your internet connection." }
			}

			// Handle timeout errors
			if (errorMessage.includes("ETIMEDOUT") || errorMessage.includes("ECONNRESET")) {
				return { error: "Connection timed out. Please check your internet connection and try again." }
			}

			return { error: `Network error: ${errorMessage}` }
		}
	}
}

// Lazily construct the service to avoid circular import initialization issues
let _voiceTranscriptionServiceInstance: VoiceTranscriptionService | null = null
export function getVoiceTranscriptionService(): VoiceTranscriptionService {
	if (!_voiceTranscriptionServiceInstance) {
		_voiceTranscriptionServiceInstance = new VoiceTranscriptionService()
	}
	return _voiceTranscriptionServiceInstance
}
