const NormalSdk = require("@normalframework/applications-sdk");
const { limit } = require("../helpers");

/**
 * Invoke hook function
 * @param {NormalSdk.InvokeParams} params
 * @returns {NormalSdk.InvokeResult}
 */
module.exports = async ({ points, sdk, groupVariables }) => {
  if(sdk.groupKey === "") {
    return {result: "success", message: "Ignoring empty group"}
  }

  sdk.logEvent("Starting sp-trim-and-respond");

  const totalRequests = points
    .where((p) => p.attrs.label === "Total SP Requests")
    .first();

  if (!totalRequests) {
    return {
      result: "error",
      message: "Missing Total Requests points in query.",
    };
  }

  const R = totalRequests.latestValue?.value;

  sdk.logEvent(`${sdk.groupKey} - Requests: ${R}`);

  sdk.logEvent(
    "Total setpoints",
    points.byLabel("discharge-air-pressure-sp").length
  );

  const DischargeAirPressureSp = points
    .byLabel("discharge-air-pressure-sp")
    .first();

  const dischargeAirPressureSpValue =
    DischargeAirPressureSp.latestValue?.value ?? 0;

  const bounds = {
    "RTU-2": { min: 0.4, max: 1.75, initial: 1.25 },
    "RTU-5": { min: 0.6, max: 1.75, initial: 1.25 },
  };

  // const bounds = {
  //   "RTU-2": { min: .9, max: 1.1 },
  //   "RTU-5": { min: 1.45, max: 1.55 }
  // }

  const bound = bounds[sdk.groupKey];

  if (!bound) {
    return { result: "error", message: "Cannot get bounds for group." };
  }

  const SP0 = bound.initial;
  const SPmin = bound.min;
  const SPmax = bound.max;
  const Td = "10m";
  const T = "2m";
  const I = 3;
  const SPtrim = -0.02;
  const SPres = 0.04;
  const SPResMax = 0.08;

  const systemStatus = points.byLabel("fan-run-cmd").first();

  console.log(systemStatus.latestValue);
  const resetToInitial =
    systemStatus?.latestValue.value === 1 &&
    systemStatus.latestValue.ts.getTime() === systemStatus.changeTime.getTime();

  if (resetToInitial) {
    sdk.logEvent("resetting to original");
    const result = await DischargeAirPressureSp.write({ real: SP0 });

    return {
      result: "success",
      message: `Reset to initial ${SP0}`,
    };
  }

  const runTandRLoop = await systemStatus.trueFor(Td, (v) => v.value === 1);

  sdk.logEvent(`Run TandR Loop: ${runTandRLoop}`);

  if (runTandRLoop) {
    // trim
    if (R <= I) {
      sdk.logEvent("trimming");
      const newSetpoint = limit(
        dischargeAirPressureSpValue + SPtrim,
        SPmin,
        SPmax
      );
      sdk.logEvent(
        JSON.stringify({ dischargeAirPressureSpValue, SPtrim, newSetpoint })
      );
      const result = await DischargeAirPressureSp.write(
        { real: newSetpoint }
      );
      return {
        result: "success",
        message: `Reset to ${newSetpoint}`,
      };
    }
    // respond
    else {
      sdk.logEvent("responding");
      const respondAmount = Math.min(SPres * (R - I), SPResMax);
      const newSetpoint = limit(
        dischargeAirPressureSpValue + respondAmount,
        SPmin,
        SPmax
      );

      sdk.logEvent(
        JSON.stringify(
          {
            respondAmount,
            newSetpoint,
            dischargeAirPressureSpValue,
            SPres,
            R,
            I,
            SPResMax,
          },
          null,
          2
        )
      );

      const result = await DischargeAirPressureSp.write(
        { real: newSetpoint }
      );
      sdk.logEvent("Write Result", JSON.stringify(result));
      return {
        result: "success",
        message: `Reset to ${newSetpoint}`,
      };
    }
  }
};