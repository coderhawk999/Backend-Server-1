const express = require('express');
const router = express.Router();
const personnel = require('../../../models/personnel');
const personnelHealth = require('../../../models/personnelHealth');
const ObjectId = require('mongodb').ObjectId;
const AuthController = require('../../../contollers/AuthController');
const { findOne, find } = require('../../../models/personnel');
const company = require('../../../models/company');
const healthParameter = require('../../../models/healthParameter');

router.post('/view', AuthController.verify_token, AuthController.is_authorized, function (req, res) {
    let average = 0;
    const averagePromise = new Promise((resolve, reject) => {
        if (req.decoded.priority == 3) {
            personnel.find({ company: ObjectId(req.decoded.company) }).then(personnels => {
                personnels.forEach((person, i) => {
                    personnelHealth.findOne({ _id: ObjectId(person.allEntries[person.allEntries.length - 1]) }).then(matchedRecord => {
                        average += matchedRecord.score;
                        if (i == personnels.length - 1) resolve(average / i);
                    }).catch(err => {
                        reject();
                    });
                })
            }).catch(err => { return res.status(500).json({ message: "Internal Server Error" }); });
        }
        else {
            personnel.find().then(personnels => {
                personnels.forEach((person, i) => {
                    console.log(person.allEntries[person.allEntries.length - 1]);
                    personnelHealth.findOne({ _id: ObjectId(person.allEntries[person.allEntries.length - 1]) }).then(matchedRecord => {
                        average += matchedRecord.score;
                        if (i == personnels.length - 1) resolve(average / i);
                    }).catch(err => {
                        reject(err);
                    });
                })
            }).catch(err => { return res.status(500).json({ message: "Internal Server Error" }); });
        }
    });

    averagePromise.then((average) => res.status(200).json({ average }))
        .catch(err => { console.log(err); res.status(500).json({ message: "Internal Server Error" }) });
});

router.post('/add', AuthController.verify_token, AuthController.is_authorized, function (req, res) {
    if (!ObjectId.isValid(req.body.personnelID)) return res.status(403).json({ message: "Invalid Personnel" });
    personnel.findOne({ _id: ObjectId(req.body.personnelID) }).then(matchedPersonnel => {
        if (!matchedPersonnel) return res.status(403).json({ message: "Unauthorized" });
        else {
            if (req.decoded.priority < 3 || req.decoded.company == matchedPersonnel.company) {
                let newHealthRep = new personnelHealth({
                    personnel: matchedPersonnel._id,
                    dateOfEntry: new Date().getTime(),
                    score: 10
                });
                req.body.parameters.forEach((param, i) => {
                    if (!ObjectId.isValid(param.healthParameter)) return res.status(403).json({ message: "Unauthorized" });
                    let currentParam = {};
                    currentParam.healthParameter = param.healthParameter;
                    if (typeof req.body.stage != 'undefined') currentParam.stage = param.stage;
                    if (typeof req.body.value != 'undefined') currentParam.value = param.value;
                    if (typeof req.body.presence != 'undefined') currentParam.presence = param.presence;
                    newHealthRep.parameters.push(currentParam);
                });
                newHealthRep.save((err, result) => {
                    if (err) return res.status(500).json({ message: "Internal Server Error" });
                    matchedPersonnel.allEntries.push(result._id);
                    if (typeof req.body.followUpRequired != 'undefined' && typeof req.body.followUpRequired == 'boolean') matchedPersonnel.followUpRequired = req.body.followUpRequired;
                    matchedPersonnel.save((err, _result) => {
                        if (err) return res.status(500).json({ message: "Internal Server Error" });
                        return res.status(200).json({ message: "Health Record Created" });
                    });
                });
            }
            else return res.status(403).json({ message: "Unauthorized" });
        }
    }).catch(err => { return res.status(500).json({ message: "Internal Server Error" }); });
});

router.post('/overview', AuthController.verify_token, AuthController.is_authorized, async function (req, res) {
    try {
        if (req.decoded.priority < 2) {
            const Company = await company.findOne({ _id: ObjectId(req.body.company) });
            if (!Company) return res.status(400).json({ message: "No Company Found" });
            const Personnels = await personnel.find({ company: ObjectId(req.body.company) });
            const HealthParameters = await healthParameter.find();
            let HealthParamStages = new Array();
            for (const Parameter of HealthParameters) {
                let paramObj = {
                    ParameterName: Parameter.name,
                    stages: new Array(),
                }
                for (const Stage of Parameter.stages) {
                    let stageObj = {
                        StageName: Stage.name,
                        count: 0
                    }
                    paramObj.stages.push(stageObj);
                }
                HealthParamStages.push(paramObj);
            }
            for (const Personnel of Personnels) {
                const LastReport = await personnelHealth.findOne({ _id: ObjectId(Personnel.allEntries[Personnel.allEntries.length - 1]) });
                if (!LastReport) continue
                for (const LReportParameter of LastReport.parameters) {
                    const HParameter = await healthParameter.findOne({ _id: ObjectId(LReportParameter.healthParameter) });
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
            return res.status(200).json({ HealthParamStages });
        }
    } catch (err) {
        console.log(err);
        return res.status(403).json({ message: "Internal Server Error" });
    }
});

router.post('/compare', AuthController.verify_token, AuthController.is_authorized, async function (req, res) {
    try {
        const Personnel = await personnel.findOne({_id:ObjectId(req.body.personnelId)});
        if (!Personnel) return res.status(400).json({ message: "No Such Police Personnel" });
        if (req.decoded.priority < 2 || req.decoded.company == personnel.company) {
            const currentRecord = await personnelHealth.findOne({_id:ObjectId(Personnel.allEntries[Personnel.allEntries.length - 1])});
            const prevRecord = await personnelHealth.findOne({_id:ObjectId(req.body.previousRecord)});
            let comparisonArr = new Array();
            for(const currParam of currentRecord.parameters){
                for(const prevParam of prevRecord.parameters){
                    if(String(currParam.healthParameter) == String(prevParam.healthParameter)){
                        const HealthParameter = await healthParameter.findOne({_id:ObjectId(currParam.healthParameter)});
                        ComparissonObj = {
                            paramName: HealthParameter.name,
                            PrevRec:{
                                value:prevParam.value,
                                stage:prevParam.stage,
                                presence:prevParam.presence
                            },
                            CurrRec:{
                                value:currParam.value,
                                stage:currParam.stage,
                                presence:currParam.presence
                            },
                            valueChange:currParam.value - prevParam.value
                        }
                        comparisonArr.push(ComparissonObj);
                    }
                }
            }
            let scoreChange = currentRecord.score - prevRecord.score;
            return res.status(200).json({
                Comparisons:comparisonArr,
                scoreChange
            })
        }
        else{
            return res.status(403).json({message: "Access Forbidden"});
        }
    }catch(err){
        console.log(err);
        return res.status(500).json({
            message:"Internal Server Error",
            error:err
        });
    }
});

module.exports = router;