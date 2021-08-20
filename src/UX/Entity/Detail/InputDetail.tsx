import * as Bitcoin from 'bitcoinjs-lib';
import React from 'react';
import './InputDetail.css';
import { OutpointDetail } from './OutpointDetail';
import Form from 'react-bootstrap/Form';
import {
    hash_to_hex,
    sequence_convert,
    time_to_pretty_string,
} from '../../../util';
import Hex from './Hex';
interface IProps {
    txinput: Bitcoin.TxInput;
    witnesses: Buffer[][];
    psbts: Bitcoin.Psbt[];
    goto: () => void;
}
interface IState {
    open: boolean;
    witness_selection: number | undefined;
    psbt: Bitcoin.Psbt | undefined;
    flash: null | any;
}
function maybeDecode(to_asm: boolean, elt: Buffer): string {
    if (to_asm) {
        return Bitcoin.script.toASM(
            Bitcoin.script.decompile(elt) ?? new Buffer('')
        );
    } else {
        return elt.toString('hex');
    }
}
export class InputDetail extends React.Component<IProps, IState> {
    form: any;
    constructor(props: IProps) {
        super(props);
        this.state = { open: false, witness_selection: undefined, psbt: undefined, flash: null };
        this.form = null;
    }
    async save_psbt(psbt: string) {
        // no await
        window.electron.save_psbt(psbt);
    }
    async sign_psbt(psbt: string) {
        const command =
            [{ method: 'walletprocesspsbt', parameters: [psbt] }];
        const signed = (await window.electron.bitcoin_command(command))[0];
        const as_psbt = Bitcoin.Psbt.fromBase64(signed.psbt);
        if (signed.complete) {
            this.setState({
                flash: (<h3 style={{ color: "green" }}>
                    Fully Signed!
                </h3>)
            })
        } else {
            this.setState({
                flash: <h3 style={{ color: "red" }}>
                    Partially Signed!
                </h3>
            })

        }
        setTimeout(() => this.setState({ flash: <div></div> }), 2000);
        return as_psbt;
    }
    render() {
        const witness_display =
            this.state.witness_selection === undefined
                ? null
                : this.props.witnesses[
                    this.state.witness_selection
                ].map((elt, i) => (
                    <Hex
                        key={i}
                        readOnly
                        className="txhex"
                        value={maybeDecode(
                            true ||
                            i ===
                            this.props.witnesses[
                                this.state.witness_selection ?? 0
                            ].length -
                            1,
                            elt
                        )}
                    />
                ));
        const psbts_display =
            this.state.psbt === undefined
                ? <><div></div><div></div></>
                : (<><Hex readOnly className="txhex" value={this.state.psbt.toBase64()} ></Hex>
                    <div title="Save PSBT to Disk">
                        <i className="glyphicon glyphicon-floppy-save SavePSBT" onClick={
                            (() => this.save_psbt(this.state.psbt!.toBase64())).bind(this)
                        }></i>
                    </div>
                    <div title="Sign PSBT Using Node Wallet">
                        <i className="glyphicon glyphicon-pencil SignPSBT" onClick={
                            (async () => {
                                const psbt = await this.sign_psbt(this.props.psbts[
                                    this.state.witness_selection ?? 0
                                ].toBase64());
                                // TODO: Confirm this saves to model?
                                this.state.psbt?.combine(psbt);
                                this.setState({ psbt: this.state.psbt });
                            }).bind(this)
                        }></i>
                    </div>
                </>);
        const scriptValue = Bitcoin.script.toASM(
            Bitcoin.script.decompile(this.props.txinput.script) ??
            Buffer.from('Error Decompiling')
        );
        const seq = this.props.txinput.sequence;
        const { relative_time, relative_height } = sequence_convert(seq);
        const sequence =
            relative_time === 0 ? (
                relative_height === 0 ? null : (
                    <div className="InputDetailSequence">
                        <span>Relative Height: </span>
                        {relative_height}
                    </div>
                )
            ) : (
                <div className="InputDetailSequence">
                    <span>Relative Time: </span>
                    {time_to_pretty_string(relative_time)}
                </div>
            );

        const witness_options = this.props.witnesses.map((w, i) => (
            <option key={i} value={i}>
                {i}
            </option>
        ));
        const scriptSig =
            this.props.txinput.script.length === 0 ? null : (
                <div className="InputDetailScriptSig">
                    <p>ScriptSig:</p>
                    <Hex readOnly className="txhex" value={scriptValue}></Hex>
                </div>
            );
        // missing horizontal
        return (
            <div>
                <OutpointDetail
                    txid={hash_to_hex(this.props.txinput.hash)}
                    n={this.props.txinput.index}
                    onClick={() => this.props.goto()}
                />
                {sequence}
                {scriptSig}
                <Form
                    onChange={() => {
                        console.log(this.form.value);
                        this.setState({
                            witness_selection: this.form.value || undefined,
                        });
                        if (this.form.value) {
                            this.setState({
                                psbt: this.props.psbts[this.form.value],
                            })
                        }
                    }}
                >
                    <Form.Group>
                        <Form.Label>
                            <div> Witness:{' '} {this.state.witness_selection}</div>
                        </Form.Label>
                        <Form.Control
                            as="select"
                            ref={(r: any) => {
                                this.form = r;
                            }}
                        >
                            <option value={undefined}></option>
                            {witness_options}
                        </Form.Control>
                    </Form.Group>
                </Form>
                {witness_display}
                {this.state.flash}
                <div className="InputDetailPSBT">
                    <div> PSBT:  </div>
                    {psbts_display}
                </div>
            </div>
        );
    }
}
