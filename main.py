from fastapi import FastAPI
from pydantic import BaseModel
import pandas as pd 
import numpy as np
import joblib
from contextlib import asynccontextmanager
from pydantic import BaseModel, Field
from typing import Literal
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles


ml_model = {} # {'model':'credit_risk_model.pkl'}
async def lifespan(app: FastAPI):
    ml_model['model'] = joblib.load('credit_risk_model.pkl')
    ml_model['threshold'] = joblib.load('best_threshold.pkl')

    yield

    ml_model.clear()



app = FastAPI(lifespan = lifespan)


# The only columns that user will see and provide inputs



class LoanApplication(BaseModel):

    person_age: int = Field(
        ...,
        ge=18,
        le=100,
        description="Age of the loan applicant",
        examples=[28]
    )

    person_income: float = Field(
        ...,
        gt=0,
        description="Annual income of the applicant",
        examples=[65000]
    )

    person_home_ownership: Literal[
        "RENT",
        "OWN",
        "MORTGAGE",
        "OTHER"
    ] = Field(
        ...,
        description="Home ownership status",
        examples=["RENT"]
    )

    person_emp_length: float = Field(
        ...,
        ge=0,
        le=100,
        description="Employment length in years",
        examples=[5]
    )

    loan_intent: Literal[
        "PERSONAL",
        "EDUCATION",
        "MEDICAL",
        "VENTURE",
        "HOMEIMPROVEMENT",
        "DEBTCONSOLIDATION"
    ] = Field(
        ...,
        description="Purpose of the loan",
        examples=["EDUCATION"]
    )

    loan_grade: Literal[
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G"
    ] = Field(
        ...,
        description="Loan grade assigned to the applicant",
        examples=["A"]
    )

    loan_amnt: float = Field(
        ...,
        gt=0,
        description="Requested loan amount",
        examples=[5000]
    )

    loan_int_rate: float = Field(
        ...,
        gt=0,
        description="Annual interest rate of the loan (%)",
        examples=[7.5]
    )

    loan_percent_income: float = Field(
        ...,
        ge=0,
        le=1,
        description="Loan amount as a percentage of annual income",
        examples=[0.08]
    )

    cb_person_default_on_file: Literal[
        "Y",
        "N"
    ] = Field(
        ...,
        description="Whether the applicant has a historical default on file",
        examples=["N"]
    )

    cb_person_cred_hist_length: int = Field(
        ...,
        ge=0,
        description="Length of credit history in years",
        examples=[6]
    )



@app.post("/predict")
def predict(data : LoanApplication):
    input_df = pd.DataFrame([data.dict()])

    probability = ml_model['model'].predict_proba(input_df)[:,1][0]

    prediction = int(probability >= ml_model['threshold'])

    return{
        'default_probability': probability,
        'default_prediction': prediction,
        'threshold':  ml_model['threshold'],
        'Result': "High Risk" if prediction == 1 else 'Low Risk'
    }


app.mount("/", StaticFiles(directory="static", html=True), name="static")