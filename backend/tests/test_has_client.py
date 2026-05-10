# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

import json
import threading
import time
from unittest.mock import Mock, patch

import pytest

from app.services.has_client import HaSClient


@pytest.fixture(autouse=True)
def _clear_shared_ner_cache():
    HaSClient.clear_shared_ner_cache()
    yield
    HaSClient.clear_shared_ner_cache()


def test_is_available_bypasses_environment_proxy():
    client = HaSClient()

    with patch.object(client._http_client, "get") as mock_get:
        mock_get.return_value.status_code = 200

        assert client.is_available() is True

    assert client._http_client.trust_env is False


def test_ner_caches_identical_text_and_type_requests():
    client = HaSClient(base_url="http://has.test/v1")
    client._health_ready = True
    payload = {"choices": [{"message": {"content": json.dumps({"PERSON": ["Alice"]})}}]}
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None

    with patch.object(client._http_client, "post", return_value=response) as mock_post:
        assert client.ner("Alice works here", ["PERSON"]) == {"PERSON": ["Alice"]}
        assert client.ner("Alice works here", ["PERSON"]) == {"PERSON": ["Alice"]}

    assert mock_post.call_count == 1


def test_ner_cache_is_shared_across_client_instances():
    first_client = HaSClient(base_url="http://has.test/v1")
    second_client = HaSClient(base_url="http://has.test/v1")
    payload = {"choices": [{"message": {"content": json.dumps({"PERSON": ["Alice"]})}}]}
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None

    with (
        patch.object(first_client._http_client, "post", return_value=response) as first_post,
        patch.object(second_client._http_client, "post") as second_post,
    ):
        assert first_client.ner("Alice works here", ["PERSON"]) == {"PERSON": ["Alice"]}
        assert second_client.ner("Alice works here", ["PERSON"]) == {"PERSON": ["Alice"]}

    assert first_post.call_count == 1
    assert second_post.call_count == 0


def test_ner_inflight_is_shared_across_client_instances():
    first_client = HaSClient(base_url="http://has.test/v1")
    second_client = HaSClient(base_url="http://has.test/v1")
    barrier = threading.Barrier(2)
    results: list[dict[str, list[str]]] = []

    def slow_model_call(_self, _messages, **_kwargs):
        time.sleep(0.05)
        return json.dumps({"PERSON": ["Alice"]})

    def worker(client: HaSClient):
        barrier.wait(timeout=1.0)
        results.append(client.ner("Alice works here", ["PERSON"]))

    with patch.object(HaSClient, "_call_model", autospec=True, side_effect=slow_model_call) as mock_call:
        threads = [
            threading.Thread(target=worker, args=(first_client,)),
            threading.Thread(target=worker, args=(second_client,)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=2.0)

    assert mock_call.call_count == 1
    assert results == [{"PERSON": ["Alice"]}, {"PERSON": ["Alice"]}]


def test_ner_cache_reuses_same_type_set_in_different_order():
    client = HaSClient(base_url="http://has.test/v1")
    payload = {"choices": [{"message": {"content": json.dumps({"PERSON": ["Alice"]})}}]}
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None

    with patch.object(client._http_client, "post", return_value=response) as mock_post:
        assert client.ner("Alice works here", ["PERSON", "ORG"]) == {"PERSON": ["Alice"]}
        assert client.ner("Alice works here", ["ORG", "PERSON"]) == {"PERSON": ["Alice"]}

    assert mock_post.call_count == 1


def test_ner_dedupes_duplicate_type_names_before_prompt():
    client = HaSClient(base_url="http://has.test/v1")
    payload = {"choices": [{"message": {"content": json.dumps({"PERSON": ["Alice"]})}}]}
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None

    with patch.object(client._http_client, "post", return_value=response) as mock_post:
        assert client.ner("Alice works here", ["PERSON", "PERSON"]) == {"PERSON": ["Alice"]}

    sent_payload = mock_post.call_args.kwargs["json"]
    prompt = sent_payload["messages"][0]["content"]
    assert 'Specified types:["PERSON"]' in prompt
    assert "Return strict JSON only" in prompt
    assert sent_payload["max_tokens"] >= 128
    assert sent_payload["temperature"] == 0.0


def test_ner_canonicalizes_alias_type_names_before_prompt():
    client = HaSClient(base_url="http://has.test/v1")
    payload = {"choices": [{"message": {"content": json.dumps({"ORG": ["Example Co."]})}}]}
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None

    with patch.object(client._http_client, "post", return_value=response) as mock_post:
        assert client.ner("Example Co. met at 08:30", ["COMPANY", "ORG", "TIME", "DATETIME"]) == {
            "ORG": ["Example Co."]
        }

    sent_payload = mock_post.call_args.kwargs["json"]
    prompt = sent_payload["messages"][0]["content"]
    assert 'Specified types:["COMPANY_NAME","ORG","TIME","DATE"]' in prompt


def test_ner_cache_returns_copies():
    client = HaSClient(base_url="http://has.test/v1")
    payload = {"choices": [{"message": {"content": json.dumps({"PERSON": ["Alice"]})}}]}
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None

    with patch.object(client._http_client, "post", return_value=response):
        first = client.ner("Alice works here", ["PERSON"])
        first["PERSON"].append("Bob")
        second = client.ner("Alice works here", ["PERSON"])

    assert second == {"PERSON": ["Alice"]}


def test_get_cached_ner_does_not_start_model_request():
    client = HaSClient(base_url="http://has.test/v1")
    payload = {"choices": [{"message": {"content": json.dumps({"PERSON": ["Alice"]})}}]}
    response = Mock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None

    with patch.object(client._http_client, "post", return_value=response) as mock_post:
        assert client.get_cached_ner("Alice works here", ["PERSON"]) is None
        assert client.ner("Alice works here", ["PERSON"]) == {"PERSON": ["Alice"]}
        cached = client.get_cached_ner("Alice works here", ["PERSON"])

    assert mock_post.call_count == 1
    assert cached == {"PERSON": ["Alice"]}
    cached["PERSON"].append("Bob")
    assert client.get_cached_ner("Alice works here", ["PERSON"]) == {"PERSON": ["Alice"]}
