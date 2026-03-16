/**
 * Composable managing graph LOD state, data fetching, and transitions.
 * Orchestrates between Galaxy (overview) and Constellation (drill-in) views.
 */
import { ref, readonly } from 'vue'
import { graphApi } from '@/api'
import type { GalaxyOverview, GalaxyTheme, ConstellationView, ConstellationNode } from '@/types'

export function useGraphNavigation() {
  const currentLevel = ref<0 | 1>(0)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Galaxy state (LOD 0)
  const galaxyData = ref<GalaxyOverview | null>(null)

  // Constellation state (LOD 1)
  const constellationData = ref<ConstellationView | null>(null)
  const selectedThemeId = ref<string | null>(null)
  const selectedThemeLabel = ref<string>('')

  // Selection state
  const hoveredTheme = ref<GalaxyTheme | null>(null)
  const hoveredNode = ref<ConstellationNode | null>(null)
  const selectedNode = ref<ConstellationNode | null>(null)

  async function loadOverview() {
    isLoading.value = true
    error.value = null
    try {
      galaxyData.value = await graphApi.overview()
      currentLevel.value = 0
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load graph'
    } finally {
      isLoading.value = false
    }
  }

  async function drillInto(themeId: string) {
    isLoading.value = true
    error.value = null
    selectedThemeId.value = themeId

    // Find theme label for breadcrumb
    const theme = galaxyData.value?.themes.find(t => t.id === themeId)
    selectedThemeLabel.value = theme?.label || 'Unknown'

    try {
      constellationData.value = await graphApi.theme(themeId)
      currentLevel.value = 1
      selectedNode.value = null
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load theme'
    } finally {
      isLoading.value = false
    }
  }

  function drillOut() {
    currentLevel.value = 0
    selectedThemeId.value = null
    selectedThemeLabel.value = ''
    constellationData.value = null
    selectedNode.value = null
    hoveredNode.value = null
  }

  function selectNode(node: ConstellationNode | null) {
    selectedNode.value = node
  }

  function clearSelection() {
    selectedNode.value = null
  }

  return {
    // State
    currentLevel: readonly(currentLevel),
    isLoading: readonly(isLoading),
    error: readonly(error),
    galaxyData: readonly(galaxyData),
    constellationData: readonly(constellationData),
    selectedThemeId: readonly(selectedThemeId),
    selectedThemeLabel: readonly(selectedThemeLabel),
    hoveredTheme,
    hoveredNode,
    selectedNode: readonly(selectedNode),

    // Actions
    loadOverview,
    drillInto,
    drillOut,
    selectNode,
    clearSelection,
  }
}
