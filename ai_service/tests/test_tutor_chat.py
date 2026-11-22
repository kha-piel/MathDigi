import json
import time
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tutor_chat import create_tutor_router, verify_user


class FakeModels:
    def __init__(self, delay=0, fail=False):
        self.delay, self.fail = delay, fail
        self.calls = []

    def generate_content_stream(self, **kwargs):
        self.calls.append(kwargs)
        time.sleep(self.delay)
        if self.fail:
            raise RuntimeError('private provider detail')
        yield SimpleNamespace(text='Gợi ý $x^2$')


def make_client(models=None, authenticated=True):
    app = FastAPI()
    app.include_router(create_tutor_router(SimpleNamespace(models=models or FakeModels()), 'fake'))
    if authenticated:
        app.dependency_overrides[verify_user] = lambda: 'student-1'
    return TestClient(app)


BODY = {'messages': [{'role': 'user', 'content': 'Tính đạo hàm?'}]}


def test_missing_token():
    assert make_client(authenticated=False).post('/api/tutor/chat', json=BODY).status_code == 401


@pytest.mark.parametrize('messages', [[], [{'role': 'assistant', 'content': 'a'}], [{'role': 'user', 'content': ' '}], [{'role': 'user', 'content': 'a' * 2001}]])
def test_bad_payload(messages):
    assert make_client().post('/api/tutor/chat', json={'messages': messages}).status_code == 422


def test_rate_limit(monkeypatch):
    monkeypatch.setenv('TUTOR_PER_MINUTE', '1')
    client = make_client()
    assert client.post('/api/tutor/chat', json=BODY).status_code == 200
    response = client.post('/api/tutor/chat', json=BODY)
    assert response.status_code == 429
    assert int(response.headers['Retry-After']) > 0


def test_stream_and_reveal():
    models = FakeModels()
    client = make_client(models)
    for reveal in (False, True):
        response = client.post('/api/tutor/chat', json={**BODY, 'reveal_solution': reveal, 'context': {'correct_answer': 'SECRET_ANSWER', 'solution': 'SOLUTION'}})
        events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
        assert events == [{'type': 'delta', 'text': 'Gợi ý $x^2$'}, {'type': 'done'}]
        assert ('SECRET_ANSWER' in models.calls[-1]['contents']) == reveal
    assert models.calls[0]['config'] != models.calls[1]['config']


def test_timeout(monkeypatch):
    monkeypatch.setenv('TUTOR_TIMEOUT_SECONDS', '0.01')
    response = make_client(FakeModels(delay=0.1)).post('/api/tutor/chat', json=BODY)
    assert '"type": "error"' in response.text
    assert '"type": "done"' not in response.text


def test_provider_error():
    response = make_client(FakeModels(fail=True)).post('/api/tutor/chat', json=BODY)
    assert '"type": "error"' in response.text
    assert 'private provider' not in response.text
