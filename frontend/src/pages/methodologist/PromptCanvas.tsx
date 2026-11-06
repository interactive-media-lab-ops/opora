/** Візуальний канвас графа промтів (React Flow). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { AnalyticsSourceKey, Graph } from '../../api/types'
import { AlertTriangle } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  cx,
  Checkbox,
} from '../../components/ui'

type PromptData = {
  dbId: number | null
  name: string
  prompt_text: string
  returns_score: boolean
  axis: string
  source: AnalyticsSourceKey | ''
  isFinal: boolean
}
type PromptNodeT = Node<PromptData, 'prompt'>

const edgeStyle = { markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 } }

function PromptNodeView({ data, selected }: NodeProps<PromptNodeT>) {
  const handle = '!size-2.5 !border-2 !border-card !bg-primary'
  return (
    <div
      className={cx(
        'grid w-56 min-w-56 gap-2 rounded-card border bg-card p-3 text-foreground',
        selected ? 'border-border-accent ring-2 ring-ring' : 'border-input',
      )}
    >
      <Handle type="target" position={Position.Left} id="in-left" className={handle} />
      <Handle type="target" position={Position.Top} id="in-top" className={handle} />
      <div className="truncate font-semibold">{data.name || 'Без назви'}</div>
      <p className="m-0 line-clamp-2 min-h-8 text-label text-muted-foreground">
        {data.prompt_text || 'Текст промта порожній'}
      </p>
      <div className="flex flex-wrap gap-1">
        {data.returns_score && <Badge tone="blue">Бал 1–10</Badge>}
        {data.axis && <Badge tone="slate">Вісь: {data.axis}</Badge>}
        {data.isFinal && <Badge tone="green">Фінальний</Badge>}
      </div>
      <Handle type="source" position={Position.Right} id="out-right" className={handle} />
      <Handle type="source" position={Position.Bottom} id="out-bottom" className={handle} />
    </div>
  )
}

const nodeTypes = { prompt: PromptNodeView }

function toFlow(graph: Graph): { nodes: PromptNodeT[]; edges: Edge[] } {
  const nodes: PromptNodeT[] = graph.nodes.map((n) => ({
    id: String(n.id),
    type: 'prompt',
    position: { x: n.position_x, y: n.position_y },
    data: {
      dbId: n.id,
      name: n.name,
      prompt_text: n.prompt_text,
      returns_score: n.returns_score,
      axis: n.axis ?? '',
      source: n.source ?? '',
      isFinal: false,
    },
  }))
  const edges: Edge[] = graph.edges.map((e) => ({
    id: `e${e.id}`,
    source: String(e.source_node_id),
    target: String(e.target_node_id),
    sourceHandle: 'out-right',
    targetHandle: 'in-left',
    ...edgeStyle,
  }))
  return { nodes, edges }
}

function reaches(edges: Edge[], from: string, to: string): boolean {
  const adj = new Map<string, string[]>()
  for (const e of edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target])
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const n = stack.pop()!
    if (n === to) return true
    if (seen.has(n)) continue
    seen.add(n)
    stack.push(...(adj.get(n) ?? []))
  }
  return false
}

function Canvas({ methodologyId }: { methodologyId: number }) {
  const qc = useQueryClient()
  const graph = useQuery({
    queryKey: ['graph', methodologyId],
    queryFn: () => api.get<Graph>(`/methodologies/${methodologyId}/graph`),
  })
  const [nodes, setNodes, onNodesChange] = useNodesState<PromptNodeT>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const counter = useRef(0)
  const loadedVersion = useRef<unknown>(null)

  useEffect(() => {
    if (!graph.data || loadedVersion.current === graph.data) return
    loadedVersion.current = graph.data
    const flow = toFlow(graph.data)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    setDirty(false)
    setSelectedId(null)
  }, [graph.data, setNodes, setEdges])

  const finalIds = useMemo(() => {
    const withOutgoing = new Set(edges.map((e) => e.source))
    return new Set(nodes.filter((n) => !withOutgoing.has(n.id)).map((n) => n.id))
  }, [nodes, edges])

  const viewNodes = useMemo(
    () =>
      nodes.map((n) =>
        n.data.isFinal === finalIds.has(n.id)
          ? n
          : { ...n, data: { ...n.data, isFinal: finalIds.has(n.id) } },
      ),
    [nodes, finalIds],
  )

  const save = useMutation({
    mutationFn: () =>
      api.put<Graph>(`/methodologies/${methodologyId}/graph`, {
        nodes: nodes.map((n) => ({
          key: n.id,
          id: n.data.dbId,
          name: n.data.name.trim() || 'Без назви',
          prompt_text: n.data.prompt_text,
          returns_score: n.data.returns_score,
          axis: n.data.axis.trim() || null,
          source: n.data.axis.trim() ? n.data.source || 'SELF' : null,
          position_x: Math.round(n.position.x),
          position_y: Math.round(n.position.y),
        })),
        edges: edges.map((e) => ({ source: e.source, target: e.target })),
      }),
    onSuccess: (data) => {
      qc.setQueryData(['graph', methodologyId], data)
    },
  })

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target || c.source === c.target) return false
      if (edges.some((e) => e.source === c.source && e.target === c.target)) return false
      return !reaches(edges, c.target, c.source) // не допускаємо циклу
    },
    [edges],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      setLocalError(null)
      setEdges((eds) => addEdge({ ...c, ...edgeStyle }, eds))
      setDirty(true)
    },
    [setEdges],
  )

  function addNode() {
    counter.current += 1
    const id = `new-${Date.now()}-${counter.current}`
    const position = nodes.length
      ? {
          x: Math.min(...nodes.map((n) => n.position.x)),
          y: Math.max(...nodes.map((n) => n.position.y)) + 150,
        }
      : { x: 80, y: 80 }
    setNodes((ns) => [
      ...ns.map((n) => (n.selected ? { ...n, selected: false } : n)),
      {
        id,
        type: 'prompt',
        position,
        data: {
          dbId: null,
          name: `Промт ${nodes.length + 1}`,
          prompt_text: '',
          returns_score: false,
          axis: '',
          source: '',
          isFinal: false,
        },
        selected: true,
      },
    ])
    setSelectedId(id)
    setDirty(true)
  }

  function updateSelected(patch: Partial<PromptData>) {
    setNodes((ns) => ns.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)))
    setDirty(true)
  }

  function deleteSelected() {
    if (!selectedId) return
    setNodes((ns) => ns.filter((n) => n.id !== selectedId))
    setEdges((es) => es.filter((e) => e.source !== selectedId && e.target !== selectedId))
    setSelectedId(null)
    setDirty(true)
  }

  function handleSave() {
    setLocalError(null)
    if (nodes.length === 0) {
      setLocalError('Додайте хоча б один промт — інакше аналіз кандидатів нічого не виконає.')
      return
    }
    save.mutate()
  }

  const selected = nodes.find((n) => n.id === selectedId)

  if (graph.isLoading) return <Spinner />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-2xl text-meta text-muted-foreground">
          Додайте промти й з’єднайте їх стрілками (з правої чи нижньої точки — до лівої чи верхньої). Вузол
          запускається, коли завершені всі вузли, з яких до нього ведуть стрілки; незалежні гілки працюють
          паралельно. Вузли без вихідних стрілок — фінальні: їхні висновки бачить HR.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <Badge tone="amber" icon={AlertTriangle}>
              Є незбережені зміни
            </Badge>
          )}
          <Button variant="secondary" onClick={addNode}>
            + Додати промт
          </Button>
          <Button onClick={handleSave} disabled={!dirty || save.isPending}>
            {save.isPending ? 'Збереження…' : 'Зберегти граф'}
          </Button>
        </div>
      </div>
      {localError && <ErrorBox message={localError} />}
      <ErrorBox error={save.error} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="h-[min(70vh,48rem)] min-h-[24rem] overflow-hidden rounded-card border border-border">
          <ReactFlow
            nodes={viewNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              onNodesChange(changes)
              if (
                changes.some((c) => c.type === 'position' && c.dragging === false) ||
                changes.some((c) => c.type === 'remove')
              )
                setDirty(true)
            }}
            onEdgesChange={(changes) => {
              onEdgesChange(changes)
              if (changes.some((c) => c.type === 'remove')) setDirty(true)
            }}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onSelectionChange={({ nodes: sel }) => setSelectedId(sel[0]?.id ?? null)}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            deleteKeyCode={['Backspace', 'Delete']}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <Card title="Вузол" className="h-fit">
          {selected ? (
            <>
              <Field label="Назва">
                <Input
                  value={selected.data.name}
                  onChange={(e) => updateSelected({ name: e.target.value })}
                />
              </Field>
              <Field
                label="Текст промта"
                hint="Дані кандидата (анкета, опитувальник, транскрипти) і висновки попередніх вузлів додаються автоматично."
              >
                <Textarea
                  rows={8}
                  className="min-h-48"
                  value={selected.data.prompt_text}
                  onChange={(e) => updateSelected({ prompt_text: e.target.value })}
                />
              </Field>
              <Checkbox
                label="Повертати бал (1–10)"
                hint="Для аналітичних вузлів. Допоміжні вузли можуть повертати лише текст."
                checked={selected.data.returns_score}
                onChange={(e) => updateSelected({ returns_score: e.target.checked })}
              />
              {selected.data.returns_score && (
                <div className="grid gap-3 rounded-card bg-muted p-3">
                  <Field
                    label="Вісь аналітики"
                    hint="Принцип, за яким оцінка потрапить на діаграму в профілі HR. Порожньо — вузол на діаграмі не показується."
                  >
                    <Input
                      value={selected.data.axis}
                      maxLength={80}
                      onChange={(e) => updateSelected({ axis: e.target.value })}
                    />
                  </Field>
                  {selected.data.axis.trim() && (
                    <Field
                      label="Джерело"
                      hint="Звідки береться ця оцінка. Лише мітка: вузол і далі бачить усі дані кандидата."
                    >
                      <Select
                        value={selected.data.source || 'SELF'}
                        onChange={(e) => updateSelected({ source: e.target.value as AnalyticsSourceKey })}
                      >
                        <option value="SELF">Самоподача (анкета, опитувальник)</option>
                        <option value="CONVERSATION">Розмова</option>
                        <option value="REVIEWS">Відгуки рекомендаторів</option>
                      </Select>
                    </Field>
                  )}
                </div>
              )}
              <div className="border-t border-border pt-3">
                <Button variant="danger" size="sm" onClick={deleteSelected}>
                  Видалити вузол
                </Button>
              </div>
            </>
          ) : (
            <p className="m-0 text-meta text-muted-foreground">
              Оберіть вузол на канвасі, щоб відредагувати його промт. Стрілку або вузол можна видалити
              клавішею Delete.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}

export function PromptCanvas({ methodologyId }: { methodologyId: number }) {
  return (
    <ReactFlowProvider>
      <Canvas methodologyId={methodologyId} />
    </ReactFlowProvider>
  )
}
