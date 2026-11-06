"""Логіка графа промтів: перевірка на цикли, готові вузли, термінальні вузли."""

from collections import defaultdict, deque
from collections.abc import Iterable


class GraphError(ValueError):
    pass


def validate_dag(node_ids: Iterable[int], edges: Iterable[tuple[int, int]]) -> list[int]:
    """Перевіряє граф і повертає топологічний порядок вузлів.

    Кидає GraphError, якщо є стрілка на невідомий вузол, петля або цикл.
    """
    nodes = set(node_ids)
    indegree: dict[int, int] = {n: 0 for n in nodes}
    adj: dict[int, list[int]] = defaultdict(list)
    seen: set[tuple[int, int]] = set()

    for src, dst in edges:
        if src not in nodes or dst not in nodes:
            raise GraphError("Стрілка веде до неіснуючого вузла")
        if src == dst:
            raise GraphError("Вузол не може посилатися сам на себе")
        if (src, dst) in seen:
            continue
        seen.add((src, dst))
        adj[src].append(dst)
        indegree[dst] += 1

    queue = deque(sorted(n for n, d in indegree.items() if d == 0))
    order: list[int] = []
    while queue:
        n = queue.popleft()
        order.append(n)
        for m in adj[n]:
            indegree[m] -= 1
            if indegree[m] == 0:
                queue.append(m)

    if len(order) != len(nodes):
        raise GraphError("У графі промтів є цикл — стрілки мають бути без зациклення")
    return order


def terminal_nodes(node_ids: Iterable[int], edges: Iterable[tuple[int, int]]) -> set[int]:
    """Вузли, з яких не виходить жодна стрілка, — їхні результати є фінальним висновком."""
    nodes = set(node_ids)
    has_outgoing = {src for src, _ in edges}
    return nodes - has_outgoing


def predecessors(edges: Iterable[tuple[int, int]]) -> dict[int, set[int]]:
    result: dict[int, set[int]] = defaultdict(set)
    for src, dst in edges:
        result[dst].add(src)
    return result


def ready_nodes(
    node_ids: Iterable[int],
    edges: Iterable[tuple[int, int]],
    done: set[int],
    started: set[int],
) -> list[int]:
    """Вузли, які ще не запущені і всі попередники яких завершені."""
    preds = predecessors(list(edges))
    return sorted(n for n in node_ids if n not in started and preds.get(n, set()) <= done)
