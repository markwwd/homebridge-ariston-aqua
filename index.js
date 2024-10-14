const request = require("requestretry");

let hap;

module.exports = function(api) {
  hap = api.hap;
  api.registerAccessory("homebridge-aristonaquawh", "AristonAquaWH", AristonWaterHeater);
}

class AristonWaterHeater {
  constructor(log, config, api) {
    try {
      this.log = log;

      this.name = config["name"];
      this.username = config["username"] || "";
      this.password = config["password"] || "";
      this.plantID = config["plantID"] || "";
      this.model = config["model"] || "VELIS Tech Dry";
      this.serial_number = config["serial_number"] || "123456789";

      this.interval = 600; // Update interval in seconds
      this.temperature = 10; // Initial temperature value
      this.powerState = false; // Initial power state

      // Initialize accessory information service
      this.informationService = new hap.Service.AccessoryInformation();
      this.informationService
        .setCharacteristic(hap.Characteristic.Name, this.name)
        .setCharacteristic(hap.Characteristic.Manufacturer, "Ariston")
        .setCharacteristic(hap.Characteristic.Model, this.model)
        .setCharacteristic(hap.Characteristic.SerialNumber, this.serial_number);

      // Initialize thermostat service
      this.thermostatService = new hap.Service.Thermostat(this.name);
      
      // Current temperature characteristic
      this.thermostatService
        .getCharacteristic(hap.Characteristic.CurrentTemperature)
        .onGet(this.getCurrentTemperature.bind(this));

      // Target temperature characteristic (to set a new temperature)
      this.thermostatService
        .getCharacteristic(hap.Characteristic.TargetTemperature)
        .setProps({ minValue: 10, maxValue: 65 })
        .onSet(this.setTemperature.bind(this))
        .onGet(this.getCurrentTemperature.bind(this));

      // Power state control (Heat or Off)
      this.thermostatService
        .getCharacteristic(hap.Characteristic.TargetHeatingCoolingState)
        .setProps({
          validValues: [hap.Characteristic.TargetHeatingCoolingState.OFF, hap.Characteristic.TargetHeatingCoolingState.HEAT]
        })
        .onSet(this.setPowerState.bind(this))
        .onGet(this.getPowerState.bind(this));

      // Start data update cycle
      this.updateDeviceData();
      setInterval(this.updateDeviceData.bind(this), this.interval * 1000);
    }
    catch (error) {
      this.log("Error initializing module: " + error);
    }
  }

  // Provide the services
  getServices() {
    return [this.informationService, this.thermostatService];
  }

  // Return the current temperature
  getCurrentTemperature() {
    return this.temperature;
  }

  // Set a new target temperature
  async setTemperature(newTemperature) {
    const oldTemperature = this.temperature;
    const data = { eco: false, new: newTemperature, old: oldTemperature };

    try {
      const response = await request.post({
        url: `https://www.ariston-net.remotethermo.com/api/v2/velis/medPlantData/${this.plantID}/temperature`,
        headers: {
          'ar.authToken': this.token,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data),
        json: true,
        maxAttempts: 3,
        retryDelay: 6000,
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
        rejectUnauthorized: false
      });

      if (response.statusCode === 200 && response.body.success) {
        this.temperature = newTemperature; // Update temperature
        this.log("Successfully changed temperature to: " + newTemperature);
      } else {
        throw new Error(`Failed to change temperature: ${response.statusCode}`);
      }
    } catch (error) {
      this.log("Error setting temperature: " + error);
    }
  }

  // Return the current power state (Heat/Off)
  getPowerState() {
    return this.powerState ? hap.Characteristic.TargetHeatingCoolingState.HEAT : hap.Characteristic.TargetHeatingCoolingState.OFF;
  }

  // Set the power state (turn the device on/off)
  async setPowerState(value) {
    const isPowerOn = value === hap.Characteristic.TargetHeatingCoolingState.HEAT;
    this.powerState = isPowerOn;

    try {
      const response = await request.post({
        url: `https://www.ariston-net.remotethermo.com/api/v2/velis/medPlantData/${this.plantID}/switch`,
        headers: {
          'ar.authToken': this.token,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        json: true,
        body: { state: isPowerOn }, // Power on/off
        maxAttempts: 3,
        retryDelay: 6000,
        retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
        rejectUnauthorized: false,
      });

      if (response.statusCode === 200) {
        this.log("Successfully changed power state to: " + (isPowerOn ? "On" : "Off"));
      } else {
        throw new Error(`Failed to change power state: ${response.statusCode}`);
      }
    } catch (error) {
      this.log("Error controlling power state: " + error);
    }
  }

  // Update device data (temperature and power state)
  updateDeviceData() {
    try {
      this.log("Updating temperature and power state data...");
      getTemperatureAPI(this);
    }
    catch (error) {
      this.log("Error updating temperature: " + error);
    }
  }
}

// Helper function to get temperature and power state from the API
function getTemperatureAPI(that) {
  try {
    request.post({
      url: "https://www.ariston-net.remotethermo.com/api/v2/accounts/login",
      form: {
        Email: that.username,
        Password: that.password,
        RememberMe: false
      },
      jar: true,
      json: true,
      maxAttempts: 3,
      retryDelay: 6000,
      retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
      rejectUnauthorized: false
    }, function(err, resp, body) {
      if (!err && resp.statusCode === 200) {
        // If login is successful, fetch temperature and power state data
        request({
          url: `https://www.ariston-net.remotethermo.com/api/v2/velis/plantData/${that.plantID}`,
          jar: true,
          json: true,
          maxAttempts: 3,
          retryDelay: 6000,
          retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
          rejectUnauthorized: false
        }, function(err, resp, body) {
          if (!err && resp.statusCode === 200) {
            that.temperature = body.temp || 10; // Update temperature
            that.powerState = body.powerState || false; // Update power state
            that.log("Successfully updated temperature: " + that.temperature + ", Power State: " + (that.powerState ? "On" : "Off"));
          } else {
            that.log("Error fetching temperature and power state data: " + (err || resp.statusCode));
          }
        });
      } else {
        that.log("Login error: " + (err || resp.statusCode));
      }
    });
  }
  catch (error) {
    that.log("Error in API request: " + error);
  }
}
