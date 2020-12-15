const express = require("express");
const router = express.Router();
const battalion = require("../../../models/battalion");
const ObjectId = require("mongodb").ObjectId;
const AuthController = require("../../../contollers/AuthController");
const company = require("../../../models/company");
const personnel = require("../../../models/personnel");
const healthParameter = require("../../../models/healthParameter");
const personnelHealth = require("../../../models/personnelHealth");

router.post("/view/:id", AuthController.verify_token, function (req, res) {
  if (req.params.id == "all")
    battalion
      .find()
      .then((battalions) => {
        return res.status(200).json({ battalions });
      })
      .catch((err) => {
        console.log(err);
        return res.status(500).json({ message: "Internal Server Error" });
      });
  else
    battalion
      .findOne({ _id: req.params.id })
      .then((matchedBattalion) => {
        return res.status(200).json({ battalion: matchedBattalion });
      })
      .catch((err) => {
        return res.status(500).json({ message: "Internal Server Error" });
      });
});

router.post(
  "/add",
  AuthController.verify_token,
  AuthController.is_authorized,
  function (req, res) {
    if (req.decoded.priority > 1)
      return res.status(403).json({ message: "Unauthorized" });
    let newBattalion = new battalion({
      battalionNumber: req.body.battalionNumber,
      location: req.body.location,
    });

    newBattalion.save((err, result) => {
      if (err)
        return res.status(500).json({ message: "Internal Server Error" });
      else return res.status(200).json({ message: "Battalion Saved" });
    });
  }
);

router.delete(
  "/remove",
  AuthController.verify_token,
  AuthController.is_authorized,
  function (req, res) {
    if (req.decoded.priority > 1)
      return res.status(403).json({ message: "Unauthorized" });
    battalion.deleteOne(
      { _id: ObjectId(req.body.battalionID) },
      (err, result) => {
        if (err)
          return res.status(500).json({ message: "Internal Server Error" });
        else return res.status(200).json({ message: "Battalion Removed" });
      }
    );
  }
);

router.post(
  "/overview",
  AuthController.verify_token,
  AuthController.is_authorized,
  async function (req, res) {
    if (!req.body.company) {
      req.body.company = req.decoded.company;
    }
    try {
      const adminCompany = company.findOne({
        _id: ObjectId(req.decoded.company),
      });
      if (
        (req.decoded.priority === 2 &&
          adminCompany.battalion == req.body.battalion) ||
        req.decoded.priority < 2
      ) {
        const Battalion = await battalion.findOne({
          _id: ObjectId(req.body.battalion),
        });
        if (!Battalion)
          return res.status(400).json({ message: "No such battalion" });
        let Personnels = new Array();
        let personnelScoresObj = {
          poor: 0,
          medium: 0,
          good: 0,
        };
        for (const cmpnyId of Battalion.companies) {
          const cmpny = await company.findOne({ _id: ObjectId(cmpnyId) });
          if (!cmpny) continue;
          for (const pId of cmpny.personnel) {
            const p = await personnel.findOne({ _id: ObjectId(pId) });
            if (!p) continue;
            Personnels.push(p);
          }
        }

        const HealthParameters = await healthParameter.find();
        let HealthParamStages = new Array();
        for (const Parameter of HealthParameters) {
          let paramObj = {
            ParameterName: Parameter.name,
            stages: new Array(),
          };
          for (const Stage of Parameter.stages) {
            let stageObj = {
              StageName: Stage.name,
              count: 0,
            };
            paramObj.stages.push(stageObj);
          }
          HealthParamStages.push(paramObj);
        }
        for (const Personnel of Personnels) {
          const LastReport = await personnelHealth.findOne({
            _id: ObjectId(
              Personnel.allEntries[Personnel.allEntries.length - 1]
            ),
          });
          if (!LastReport) continue;

          if (LastReport.score < 4) personnelScoresObj.poor += 1;
          else if (LastReport.score >= 4 && LastReport.score < 7)
            personnelScoresObj.medium += 1;
          else personnelScoresObj.good += 1;

          for (const LReportParameter of LastReport.parameters) {
            const HParameter = await healthParameter.findOne({
              _id: ObjectId(LReportParameter.healthParameter),
            });
            if (HParameter) {
              for (const HealthParamStage of HealthParamStages) {
                if (HParameter.name == HealthParamStage.ParameterName) {
                  const currentParam = HealthParamStage;
                  for (const currentStage of currentParam.stages) {
                    if (LReportParameter.stage == currentStage.StageName) {
                      currentStage.count += 1;
                    }
                  }
                }
              }
            }
          }
        }
        //Avg Weight over a specified number of months :Starts here
        //DO NOT TOUCH
        let monthAvgWeightArr = new Array();
        const dateNow = new Date();
        const currentMonth = dateNow.getMonth();
        let currentYear = dateNow.getFullYear();
        let numberOfMonths = req.body.numberOfMonths;
        if (numberOfMonths > 70) return res.status(400).json({ message: "Number of months exceeded threshold of 70 months" });
        let tempMonth;
        for (let i = 0; i < numberOfMonths; i++) {
          if ((currentMonth - i) % 12 == -1 && currentMonth - i <= -1) currentYear--;
          if (currentMonth - i <= -1) {
            tempMonth = 11 - ((-(currentMonth + 1 - i)) % 12);
          }
          else {
            tempMonth = currentMonth - i;
          }
          const dateLessThan = new Date(String(currentYear) + "-" + String(tempMonth + 1) + "-" + String(31));
          const dateGreaterThan = new Date(String(currentYear) + "-" + String(tempMonth + 1) + "-" + String(1));
          //DO NOT TOUCH
          let TotalWeight = 0;
          let TotalRec= 0;
          for (const cmp of Battalion.companies) {
            const PersonHealthCurrMon = await personnel.aggregate([{
              $match: { "company": ObjectId(cmp) }
            },
            {
              $lookup: {
                from: "personnelhealths",
                as: "CurrMonRecs",
                let: { "pId": "$_id" },
                pipeline: [{
                  $match: {
                    $expr: {
                      $and: [{ $eq: [{ $toObjectId: "$personnel" }, { $toObjectId: "$$pId" }] },
                      { $gte: ["$dateOfEntry", dateGreaterThan] },
                      { $lte: ["$dateOfEntry", dateLessThan] }]
                    }
                  }
                }]
              }
            }, {
              $project: {
                "company": 1,
                "CurrMonRecs": {
                  "dateOfEntry": 1,
                  "weight": 1
                }
              }
            }
            ]);
            let weightSum = 0;
            let recCount = 0;
            for (const i of PersonHealthCurrMon) {
              console.log(i.company);
              if (i.CurrMonRecs.length != 0) {
                for (const j of i.CurrMonRecs) {
                  console.log(j.weight,j.dateOfEntry);
                  weightSum += j.weight;
                  recCount++;
                }
              }
            }
            TotalWeight += weightSum;
            TotalRec += recCount; 
          }
          monthlyAvgObj = {
            Month: tempMonth + 1,
            Year: currentYear,
            AverageWeight: TotalWeight / TotalRec
          }
          monthAvgWeightArr.push(monthlyAvgObj);
        }
        //Avg Weight over a specified number of months :Ends here
        return res.status(200).json({ HealthParamStages, personnelScoresObj,monthAvgWeightArr });
      } else return res.status(401).json({ message: "Unauthorized" });
    } catch (err) {
      console.log(err);
      return res.status(403).json({ message: "Internal Server Error" });
    }
  }
);

router.post(
  "/individualOverview",
  AuthController.verify_token,
  AuthController.is_authorized,
  async function (req, res) {
    try {
      const adminCompany = company.findOne({
        _id: ObjectId(req.decoded.company),
      });
      if (
        (req.decoded.priority === 2 &&
          adminCompany.battalion == req.body.battalion) ||
        req.decoded.priority < 2
      ) {
        const Battalion = await battalion.findOne({
          _id: ObjectId(req.body.battalion),
        });
        if (!Battalion)
          return res.status(400).json({ message: "No such battalion" });

        let Personnels = new Array();
        for (const cmpnyId of Battalion.companies) {
          const cmpny = await company.findOne({ _id: ObjectId(cmpnyId) });
          if (!cmpny) continue;
          for (const pId of cmpny.personnel) {
            const p = await personnel.findOne({ _id: ObjectId(pId) });
            if (!p) continue;
            Personnels.push(p);
          }
        }

        let individualInfoArr = new Array();
        for (const p of Personnels) {
          const lastRecord = await personnelHealth.findOne({
            _id: ObjectId(p.allEntries[p.allEntries.length - 1]),
          });
          let weight, height, score;
          if (!lastRecord) {
            weight = "No records";
            height = "No records";
            score = "No records";
          } else {
            weight = lastRecord.weight;
            height = lastRecord.height;
            score = lastRecord.score;
          }
          const CompanyInfo = await company.findById(p.company);
          const individualInfoObj = {
            _id: p._id,
            metalNo: p.metalNo,
            Name: p.personnelName,
            Weight: weight,
            height: height,
            Company: p.company,
            companyName: CompanyInfo.companyName,
            rank: p.rank,
            Score: score,
          };
          individualInfoArr.push(individualInfoObj);
        }
        res.status(200).json({ individualInfoArr });
      }
    } catch (err) {
      console.log(err);
      return res.status(500).json({ message: "Internal Server Error", err });
    }
  }
);

module.exports = router;
