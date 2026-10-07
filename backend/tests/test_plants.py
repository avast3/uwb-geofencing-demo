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


def _size(zone):
    return round(zone["x_max"] - zone["x_min"], 6), round(zone["y_max"] - zone["y_min"], 6)


def _create(x=4.0, y=3.0):
    res = client.post("/api/plants", json={"x": x, "y": y})
    assert res.status_code == 200
    return res.json()


def test_create_plant_makes_two_zones_with_spec_sizes():
    body = _create()
    plant, zones = body["plant"], body["zones"]
    assert plant["plant_id"].startswith("PLANT-")
    assert plant["name"].startswith("Plant ")
    assert plant["heading"] == "horizontal"
    assert (plant["home_x"], plant["home_y"]) == (4.0, 3.0)

    by_type = {z["type"]: z for z in zones}
    assert _size(by_type["exclusion"]) == (2.2, 1.3)
    assert _size(by_type["warning"]) == (3.4, 2.5)
    assert by_type["exclusion"]["name"] == f"{plant['name']} Exclusion"
    assert by_type["warning"]["name"] == f"{plant['name']} Warning"
    for z in zones:
        assert z["plant_id"] == plant["plant_id"]

    listed_ids = {z["zone_id"] for z in client.get("/api/zones").json()}
    assert {plant["exclusion_zone_id"], plant["warning_zone_id"]} <= listed_ids


def test_vertical_heading_swaps_zone_dimensions_and_moves_centre():
    plant = _create()["plant"]
    res = client.post(
        f"/api/plants/{plant['plant_id']}/position",
        json={"x": 5.0, "y": 2.5, "heading": "vertical"},
    )
    assert res.status_code == 200
    by_type = {z["type"]: z for z in res.json()["zones"]}
    assert _size(by_type["exclusion"]) == (1.3, 2.2)
    assert _size(by_type["warning"]) == (2.5, 3.4)
    exc = by_type["exclusion"]
    assert (exc["x_min"] + exc["x_max"]) / 2 == pytest.approx(5.0)
    assert (exc["y_min"] + exc["y_max"]) / 2 == pytest.approx(2.5)


def test_reset_returns_plant_home_and_horizontal():
    plant = _create(2.0, 2.0)["plant"]
    client.post(f"/api/plants/{plant['plant_id']}/position", json={"x": 6, "y": 4, "heading": "vertical"})
    body = client.post(f"/api/plants/{plant['plant_id']}/reset").json()
    assert (body["plant"]["x"], body["plant"]["y"], body["plant"]["heading"]) == (2.0, 2.0, "horizontal")
    exc = next(z for z in body["zones"] if z["type"] == "exclusion")
    assert _size(exc) == (2.2, 1.3)


def test_unknown_plant_returns_404():
    assert client.post("/api/plants/PLANT-999/position", json={"x": 1, "y": 1, "heading": "horizontal"}).status_code == 404
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
    client.post(f"/api/plants/{plant['plant_id']}/position", json={"x": 6.0, "y": 4.0, "heading": "horizontal"})
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
