"use server"

import { getModelId, rooCodeSettingsSchema } from "@roo-code/types"
import { getRuns, getLanguageScores } from "@roo-code/evals"

import { formatScore } from "@/lib"

export async function getEvalRuns() {
	try {
		if (!process.env.DATABASE_URL) {
			return []
		}
		const languageScores = await getLanguageScores()

		const runs = (await getRuns())
			.filter((run) => !!run.taskMetrics)
			.filter(({ settings }) => rooCodeSettingsSchema.safeParse(settings).success)
			.sort((a, b) => b.passed - a.passed)
			.map((run) => {
				const settings = rooCodeSettingsSchema.parse(run.settings)

				return {
					...run,
					label: run.description || run.model,
					score: formatScore(run.passed / (run.passed + run.failed)),
					languageScores: languageScores[run.id] || { go: 0, java: 0, javascript: 0, python: 0, rust: 0 },
					taskMetrics: run.taskMetrics!,
					modelId: getModelId(settings),
				}
			})

		return runs
	} catch (error) {
		console.warn("[AI Studio] Failed to fetch eval runs:", error)
		return []
	}
}
