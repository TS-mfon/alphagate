import json


CONTRACT = "contracts/genlayer/AlphaGateConsensus.py"
REQUEST_ID = "0x" + "11" * 32
INPUT_HASH = "0x" + "22" * 32
EVIDENCE_HASH = "0x" + "33" * 32


def deploy(direct_deploy, direct_alice):
    return direct_deploy(CONTRACT, f"0x{direct_alice.hex()}", "0xTreasury")


def test_operator_claims_and_duplicate_is_idempotent(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy, direct_alice)
    direct_vm.sender = direct_alice

    first = contract.claim_request(REQUEST_ID, "trade_guard", INPUT_HASH, 100_000)
    second = contract.claim_request(REQUEST_ID, "trade_guard", INPUT_HASH, 100_000)

    assert first["status"] == "claimed"
    assert second["request_id"] == REQUEST_ID
    assert contract.get_metrics()["request_count"] == "1"


def test_non_operator_cannot_claim(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = deploy(direct_deploy, direct_alice)
    direct_vm.sender = direct_bob

    with direct_vm.expect_revert("Only the configured operator may write"):
        contract.claim_request(REQUEST_ID, "trade_guard", INPUT_HASH, 100_000)


def test_deterministic_completion_updates_accounting(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy, direct_alice)
    direct_vm.sender = direct_alice
    contract.claim_request(REQUEST_ID, "trade_guard", INPUT_HASH, 100_000)

    result = contract.finalize_deterministic(
        REQUEST_ID,
        EVIDENCE_HASH,
        json.dumps({
            "verdict": "ALLOW",
            "risk_score": 18,
            "max_position_usd": "500",
            "reasons": ["No hard block found."],
        }),
        6_000,
    )

    stored = contract.get_request(REQUEST_ID)
    metrics = contract.get_metrics()
    assert result["verdict"] == "ALLOW"
    assert stored["status"] == "completed"
    assert stored["retained_units"] == "94000"
    assert metrics["gross_units"] == "100000"
    assert metrics["upstream_cost_units"] == "6000"
    assert metrics["retained_units"] == "94000"


def test_failed_request_does_not_count_revenue(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy, direct_alice)
    direct_vm.sender = direct_alice
    contract.claim_request(REQUEST_ID, "alpha_router", INPUT_HASH, 250_000)
    contract.fail_request(REQUEST_ID, "provider timeout")

    stored = contract.get_request(REQUEST_ID)
    metrics = contract.get_metrics()
    assert stored["status"] == "failed"
    assert metrics["failed_count"] == "1"
    assert metrics["gross_units"] == "0"


def test_trade_guard_llm_result_is_stored(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy, direct_alice)
    direct_vm.sender = direct_alice
    direct_vm.mock_llm(
        r".*AlphaGate.*",
        json.dumps({
            "verdict": "SIZE_DOWN",
            "risk_score": 61,
            "max_position_usd": "175",
            "reasons": ["Signals conflict with the requested side."],
        }),
    )
    contract.claim_request(REQUEST_ID, "trade_guard", INPUT_HASH, 100_000)

    result = contract.analyze_request(
        REQUEST_ID,
        '{"side":"buy","position_usd":"500"}',
        '{"signals":["long","short"]}',
        EVIDENCE_HASH,
        16_000,
    )

    assert result["verdict"] == "SIZE_DOWN"
    assert contract.get_request(REQUEST_ID)["status"] == "completed"


def test_invalid_result_is_rejected(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy, direct_alice)
    direct_vm.sender = direct_alice
    contract.claim_request(REQUEST_ID, "trade_guard", INPUT_HASH, 100_000)

    with direct_vm.expect_revert("Invalid TradeGuard verdict"):
        contract.finalize_deterministic(
            REQUEST_ID,
            EVIDENCE_HASH,
            '{"verdict":"YOLO","risk_score":1}',
            1_000,
        )
