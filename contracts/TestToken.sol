pragma solidity ^0.4.24;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20Detailed.sol";

contract TestToken is ERC20Mintable, ERC20Detailed {
    constructor(string name, string symbol) ERC20Detailed(name, symbol, 18) public {
        mint(msg.sender, 10**24);
    }
}
