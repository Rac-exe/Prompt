_SERVICE_READY = False


def is_service_ready() -> bool:
    return _SERVICE_READY


def set_service_ready(value: bool) -> None:
    global _SERVICE_READY
    _SERVICE_READY = bool(value)
