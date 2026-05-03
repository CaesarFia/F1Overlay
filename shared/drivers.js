let roster = [];
let byNumber = new Map();

export function init(driversArray) {
  roster = [...driversArray];
  byNumber = new Map(roster.map((d) => [String(d.driver_number), d]));
}

export function getAllDrivers() { return roster; }
export function getDriverByNumber(driverNumber) { return byNumber.get(String(driverNumber)) ?? null; }
