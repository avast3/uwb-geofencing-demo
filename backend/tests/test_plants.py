import math

import pytest
from fastapi.testclient import TestClient

from app import state
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_state():
    state.clear_zones()
    state.clear_events()
    state.set_zone_membership("TAG-001", set())
    yield


# A single UWB tag gives position but not orientation, so plant zones are
# circles that cover the truck body (1.6 x 0.7 m) whichever way it faces.
HALF_DIAGONAL_M = math.hypot(1.6 / 2, 0.7 / 2)
EXCLUSION_RADIUS_M = HALF_DIAGONAL_M + 0.3
WARNING_RADIUS_M = EXCLUSION_RADIUS_M + 0.6


def _centre(zone):
    return zone["centre_x"], zone["centre_y"]


def _create(x=4.0, y=3.0):
    res = client.post("/api/plants", json={"x": x, "y": y})
    assert res.status_code == 200
    return res.json()


def test_create_plant_makes_two_circle_zones_covering_any_orientation():
    body = _create()
    plant, zones = body["plant"], body["zones"]
    assert plant["plant_id"].startswith("PLANT-")
    assert plant["name"].startswith("Plant ")
    assert "heading" not in plant
    assert (plant["home_x"], plant["home_y"]) == (4.0, 3.0)

    by_type = {z["type"]: z for z in zones}
    for zone in zones:
        assert zone["shape"] == "circle"
        assert _centre(zone) == (4.0, 3.0)
    assert by_type["exclusion"]["radius"] == pytest.approx(EXCLUSION_RADIUS_M)
    assert by_type["warning"]["radius"] == pytest.approx(WARNING_RADIUS_M)
    assert by_type["exclusion"]["name"] == f"{plant['name']} Exclusion"
    assert by_type["warning"]["name"] == f"{plant['name']} Warning"
    for z in zones:
        assert z["plant_id"] == plant["plant_id"]

    listed_ids = {z["zone_id"] for z in client.get("/api/zones").json()}
    assert {plant["exclusion_zone_id"], plant["warning_zone_id"]} <= listed_ids


def test_position_update_recentres_zones_without_needing_a_heading():
    plant = _create()["plant"]
    res = client.post(f"/api/plants/{plant['plant_id']}/position", json={"x": 5.0, "y": 2.5})
    assert res.status_code == 200
    for zone in res.json()["zones"]:
        assert _centre(zone) == (5.0, 2.5)
    by_type = {z["type"]: z for z in res.json()["zones"]}
    assert by_type["exclusion"]["radius"] == pytest.approx(EXCLUSION_RADIUS_M)


def test_reset_returns_plant_and_zones_home():
    plant = _create(2.0, 2.0)["plant"]
    client.post(f"/api/plants/{plant['plant_id']}/position", json={"x": 6, "y": 4})
    body = client.post(f"/api/plants/{plant['plant_id']}/reset").json()
    assert (body["plant"]["x"], body["plant"]["y"]) == (2.0, 2.0)
    for zone in body["zones"]:
        assert _centre(zone) == (2.0, 2.0)


def test_unknown_plant_returns_404():
    assert client.post("/api/plants/PLANT-999/position", json={"x": 1, "y": 1}).status_code == 404
    assert client.post("/api/plants/PLANT-999/reset").status_code == 404
    assert client.delete("/api/plants/PLANT-999").status_code == 404


def test_delete_plant_removes_both_zones():
    plant = _create()["plant"]
    assert client.delete(f"/api/plants/{plant['plant_id']}").json() == {"plant_id": plant["plant_id"], "deleted": True}
    assert client.get("/api/zones").json() == []
    assert client.get("/api/plants").json() == []


def test_clear_zones_also_clears_plants():
    _create()
    client.delete("/api/zones")
    assert client.get("/api/plants").json() == []


def test_plant_zones_cannot_be_edited_or_deleted_via_zone_api():
    plant = _create()["plant"]
    zone = next(z for z in client.get("/api/zones").json() if z["zone_id"] == plant["exclusion_zone_id"])
    put = client.put(f"/api/zones/{zone['zone_id']}", json={**zone, "name": "hacked"})
    assert put.status_code == 409
    assert client.delete(f"/api/zones/{zone['zone_id']}").status_code == 409


def test_creating_a_zone_that_claims_a_plant_is_rejected():
    res = client.post(
        "/api/zones",
        json={"shape": "rectangle", "name": "x", "type": "exclusion", "x_min": 0, "x_max": 1, "y_min": 0, "y_max": 1, "plant_id": "PLANT-1"},
    )
    assert res.status_code == 400


def test_plant_driving_onto_stationary_worker_breaches():
    plant = _create(1.5, 1.5)["plant"]
    worker = {"tag_id": "TAG-001", "x": 6.0, "y": 4.0, "anchors_active": ["A1", "A2", "A3", "A4"]}
    assert client.post("/api/position", json=worker).json()["state"] == "SAFE"
    client.post(f"/api/plants/{plant['plant_id']}/position", json={"x": 6.0, "y": 4.0})
    result = client.post("/api/position", json=worker).json()
    assert result["state"] == "BREACH"
    assert result["zone_id"] == plant["exclusion_zone_id"]
    alerts = [e for e in client.get("/api/events").json() if e["requires_ack"]]
    assert alerts[-1]["zone_name"] == f"{plant['name']} Exclusion"


def test_deleting_plant_with_worker_inside_does_not_crash():
    plant = _create(4.0, 3.0)["plant"]
    worker = {"tag_id": "TAG-001", "x": 4.0, "y": 3.0, "anchors_active": ["A1", "A2", "A3", "A4"]}
    assert client.post("/api/position", json=worker).json()["state"] == "BREACH"
    events_before = len(client.get("/api/events").json())
    client.delete(f"/api/plants/{plant['plant_id']}")
    res = client.post("/api/position", json=worker)
    assert res.status_code == 200
    assert res.json()["state"] == "SAFE"
    # No EXITED event is logged for a zone that no longer exists.
    assert len(client.get("/api/events").json()) == events_before
