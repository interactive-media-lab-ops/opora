"""Тонкий шар над Celery: API не залежить від брокера напряму, а тести можуть підмінити функції."""


def enqueue_assessment_processing(assessment_id: int) -> None:
    from app.tasks.pipeline import process_assessment

    process_assessment.delay(assessment_id)


def enqueue_retry_analysis(assessment_id: int, only_failed: bool = True) -> None:
    from app.tasks.pipeline import retry_analysis

    retry_analysis.delay(assessment_id, only_failed)
