let drivers = [];
let byNumber = new Map();

export function init(list) {
  drivers = Array.isArray(list) ? list : [];
  byNumber = new Map(drivers.map((d) => [String(d.driver_number), d]));
}

export function getAllDrivers() { return drivers; }
export function getDriver(driverNumber) { return byNumber.get(String(driverNumber)); }
