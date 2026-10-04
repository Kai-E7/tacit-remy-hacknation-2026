import unittest
from service import redact, analyze

class RedactionTest(unittest.TestCase):
    def test_real_engines_redact_synthetic_person_email_phone_and_iban(self):
        raw = "Jane Doe emails jane.doe@example.com. Call +49 30 12345678. IBAN DE89 3704 0044 0532 0130 00."
        result = redact([raw])
        self.assertEqual(result["report"]["engine"], "presidio")
        self.assertEqual(result["report"]["status"], "redaction applied")
        for value in ["Jane Doe", "jane.doe@example.com", "12345678", "3704"]:
            self.assertNotIn(value, result["texts"][0])

    def test_false_positive_control_and_no_fictitious_guarantee(self):
        text = "Open Outlook and then Notion. Invoice total 5000 EUR."
        self.assertEqual(redact([text])["texts"], [text])
        self.assertEqual(redact([text])["report"]["status"], "privacy scan passed")
        self.assertEqual(redact(["Angebot prüfen", "Angebot in Outlook prüfen"])["texts"], ["Angebot prüfen", "Angebot in Outlook prüfen"])

    def test_german_name_and_invalid_iban_like_value(self):
        text = "Max Mustermann prüft die Rechnung. IBAN DE00 3704 0044 0532 0130 00."
        result = redact([text])["texts"][0]
        self.assertNotIn("Max Mustermann", result)
        self.assertNotIn("DE00", result)

    def test_idempotent_redaction(self):
        safe = redact(["Jane Doe emails jane.doe@example.com."])["texts"]
        self.assertEqual(redact(safe)["texts"], safe)

    def test_image_ocr_offsets_cover_synthetic_identifiers(self):
        text = "Jane Doe\njane.doe@example.com\nOutlook\nDE89 3704 0044 0532 0130 00"
        spans = analyze(text)
        covered = " ".join(text[s["start"]:s["end"]] for s in spans)
        self.assertIn("Jane Doe", covered)
        self.assertIn("jane.doe@example.com", covered)
        self.assertIn("DE89", covered)
        self.assertNotIn("Outlook", covered)

if __name__ == "__main__":
    unittest.main()
