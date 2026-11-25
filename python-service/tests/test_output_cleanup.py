"""
Optimizer output clean-up: leaked analysis headers are stripped, real prompt
text is never cut.

Run from python-service/:  venv\\Scripts\\python.exe -m unittest discover tests
"""

import unittest

from pipeline_v2.optimizer import _ANALYSIS_LEAK_RE, _find_prompt_start_after_analysis


def strip(text: str) -> str:
    """The non-streaming path in optimizer.optimize()."""
    cleaned = text.strip()
    if cleaned and _ANALYSIS_LEAK_RE.search(cleaned[:500]):
        start = _find_prompt_start_after_analysis(cleaned)
        if 0 < start < len(cleaned):
            cleaned = cleaned[start:].lstrip("\n")
    return cleaned


class KeepsRealPrompts(unittest.TestCase):
    def test_decision_making_is_not_a_leak(self):
        # The pilot benchmark returned "-making" for this kind of prompt.
        prompt = (
            "Compare two ways to use $100,000 and recommend one.\n\n"
            "- Option 1: invest in shares at an expected 8% a year.\n"
            "- Option 2: buy a car that loses 15% of its value a year.\n\n"
            "Explain the trade-offs that matter for the decision-making, then give a clear recommendation."
        )
        self.assertEqual(strip(prompt), prompt)

    def test_capitalised_decision_heading_is_kept(self):
        prompt = "TASK:\nPick a database.\n\nDECISION CRITERIA:\n- cost\n- scale"
        self.assertEqual(strip(prompt), prompt)

    def test_classification_task_is_kept(self):
        prompt = "Classification task: label each review as positive or negative.\nCLASSIFICATION RULES:\n- one label each"
        self.assertEqual(strip(prompt), prompt)

    def test_user_context_in_prose_is_kept(self):
        prompt = "Write onboarding copy. Use the user context from the survey below to pick the tone."
        self.assertEqual(strip(prompt), prompt)


class StripsLeaks(unittest.TestCase):
    def test_header_block_then_separator(self):
        leaked = (
            "**DECISION TAKER (DT):** NEW\n"
            "**SKILL SELECTOR (SF):** Business\n"
            "**OPTIMIZATION TECHNIQUES (PO):** role, constraints\n\n"
            "---\n\n"
            "Write a one-page business plan for a bakery."
        )
        self.assertEqual(strip(leaked), "Write a one-page business plan for a bakery.")

    def test_classification_label(self):
        leaked = "CLASSIFICATION: NEW\n\nWrite a haiku about rain."
        self.assertEqual(strip(leaked), "Write a haiku about rain.")

    def test_bare_request_type_line(self):
        leaked = "**NEW REQUEST**\n\nSummarise this article in five bullet points."
        self.assertEqual(strip(leaked), "Summarise this article in five bullet points.")


if __name__ == "__main__":
    unittest.main()
