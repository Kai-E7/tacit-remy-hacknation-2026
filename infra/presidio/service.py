"""Private synthetic-demo text and OCR-span service. No request/body logging.

Default loopback binding. Put behind private networking/TLS with PRESIDIO_TOKEN
before any non-loopback use. No image endpoint and no persistence.
"""
import hmac
import json
import logging
import os
import tldextract
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

logging.disable(logging.CRITICAL)
# Use bundled suffix data only: no network refresh or disk cache at request time.
tldextract.extract = tldextract.TLDExtract(cache_dir=None, suffix_list_urls=())
engine = NlpEngineProvider(nlp_configuration={"nlp_engine_name": "spacy", "models": [
    {"lang_code": "en", "model_name": "en_core_web_sm"},
    {"lang_code": "de", "model_name": "de_core_news_sm"},
]}).create_engine()
analyzer = AnalyzerEngine(nlp_engine=engine, supported_languages=["en", "de"])
for lang in ["en", "de"]:
    analyzer.registry.add_recognizer(PatternRecognizer(supported_entity="IBAN_CODE", supported_language=lang,
        patterns=[Pattern("iban-like-demo", r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b", .85)]))
anonymizer = AnonymizerEngine()
ENTITIES = ["PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "IBAN_CODE"]
DEMO_DOMAIN_TERMS = {"outlook", "notion", "excel", "angebot", "rechnung", "rechnungsprüfung"}


def analyze(text):
    results = []
    offset = 0
    # OCR lines are independent visual fields. Per-line NER avoids a noisy model
    # merging an app label and multiple identifiers into one PERSON entity.
    for chunk in text.splitlines(keepends=True):
        line = chunk.rstrip("\r\n")
        for lang in ["en", "de"]:
            for r in analyzer.analyze(text=line, language=lang, entities=ENTITIES, score_threshold=.5):
                if r.entity_type == "PERSON" and line[r.start:r.end].casefold() in DEMO_DOMAIN_TERMS:
                    continue
                results.append((offset + r.start, offset + r.end, r.entity_type))
        offset += len(chunk)
    # Identical spans from two language models need only one mask.
    unique = set(results)
    return [{"start": start, "end": end, "entity": entity} for start, end, entity in sorted(unique)]


def redact(texts):
    output, count = [], 0
    for text in texts:
        results = []
        for lang in ["en", "de"]:
            results.extend(analyzer.analyze(text=text, language=lang, entities=ENTITIES, score_threshold=.5))
        # Narrow disclosed domain allow-list for cross-language NER false positives.
        results = [r for r in results if not (r.entity_type == "PERSON" and text[r.start:r.end].casefold() in DEMO_DOMAIN_TERMS)]
        # Standard replacement: no reversible lookup table retaining original values.
        result = anonymizer.anonymize(text=text, analyzer_results=results,
            operators={entity: OperatorConfig("replace", {"new_value": f"[{entity}]"}) for entity in ENTITIES})
        output.append(result.text)
        count += len(result.items)
    return {"texts": output, "report": {"engine": "presidio", "status": "redaction applied" if count else "privacy scan passed",
        "redactions": count, "imagesWithheld": 0, "policy": "text-v1"}}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, code, body):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        token = os.environ.get("PRESIDIO_TOKEN", "")
        if token and not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {token}"):
            return self.reply(401, {"error": "unauthorized"})
        if self.path not in ["/redact", "/analyze"]:
            return self.reply(404, {"error": "not_found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 1000000:
                return self.reply(413, {"error": "too_large"})
            self.connection.settimeout(15)
            body = json.loads(self.rfile.read(length))
            if self.path == "/analyze":
                text = body["text"]
                if not isinstance(text, str) or len(text) > 12000:
                    return self.reply(400, {"error": "invalid_request"})
                return self.reply(200, {"spans": analyze(text)})
            else:
                texts = body["texts"]
                if not isinstance(texts, list) or len(texts) > 250 or any(not isinstance(t, str) or len(t) > 6000 for t in texts):
                    return self.reply(400, {"error": "invalid_request"})
                self.reply(200, redact(texts))
        except Exception:
            self.reply(400, {"error": "redaction_failed"})


if __name__ == "__main__":
    host = os.environ.get("PRESIDIO_HOST", "127.0.0.1")
    if host not in ["127.0.0.1", "localhost"] and len(os.environ.get("PRESIDIO_TOKEN", "")) < 32:
        raise SystemExit("Non-loopback binding requires PRESIDIO_TOKEN (32+ characters).")
    ThreadingHTTPServer((host, int(os.environ.get("PRESIDIO_PORT", "5003"))), Handler).serve_forever()
