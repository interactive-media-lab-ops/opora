import pytest

from app.services.graph import GraphError, ready_nodes, terminal_nodes, validate_dag


def test_linear_chain_order():
    assert validate_dag([1, 2, 3], [(1, 2), (2, 3)]) == [1, 2, 3]


def test_cycle_rejected():
    with pytest.raises(GraphError):
        validate_dag([1, 2, 3], [(1, 2), (2, 3), (3, 1)])


def test_self_loop_rejected():
    with pytest.raises(GraphError):
        validate_dag([1], [(1, 1)])


def test_unknown_node_rejected():
    with pytest.raises(GraphError):
        validate_dag([1, 2], [(1, 3)])


def test_terminal_nodes():
    assert terminal_nodes([1, 2, 3, 4], [(1, 3), (2, 3), (3, 4)]) == {4}
    assert terminal_nodes([1, 2], []) == {1, 2}


def test_ready_nodes_parallel_then_join():
    nodes = [1, 2, 3]
    edges = [(1, 3), (2, 3)]
    assert ready_nodes(nodes, edges, done=set(), started=set()) == [1, 2]
    assert ready_nodes(nodes, edges, done={1}, started={1, 2}) == []
    assert ready_nodes(nodes, edges, done={1, 2}, started={1, 2}) == [3]
